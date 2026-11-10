'use strict';

const { randomUUID } = require('node:crypto');
const { ActionRowBuilder, ButtonStyle, ComponentType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton, isModal, respond, ephemeral } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener, reportInteractionError } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { createTicketChannelGateway } = require('../adapters/discord/ticket-channel-gateway');
const { openTicketsPayload } = require('../adapters/discord/ticket-view');
const { requirePrivateStaffChannel } = require('../adapters/discord/staff-pin-channel');
const { requireStaffChannel } = require('./dashboards-feature');

function requestPayload(shopEnabled) {
  return {
    content:'Search the in-game F1 shop before creating a support request.\n\n**DLC creature requests:** You may request an official DLC creature, but if you do not own the required DLC, the game may prevent you from using the creature or some of its abilities.',
    components:[{
      type:ComponentType.ActionRow,
      components:[
        ...(shopEnabled ? [{ type:ComponentType.Button, custom_id:'v2:shop:search', label:'Search In-Game Shop', style:ButtonStyle.Primary }] : []),
        { type:ComponentType.Button, custom_id:'v2:request:open', label:'Open Request', style:ButtonStyle.Success }
      ]
    }],
    allowedMentions:{ parse:[] }
  };
}

function legacyPanelPayload() {
  return {
    content:'**Legacy ticket management**\nManage preserved record-only tickets from earlier V2 releases. Enter the ticket ID from the staff audit records. No private channel will be created.',
    components:[{ type:ComponentType.ActionRow, components:[{
      type:ComponentType.Button, custom_id:'v2:legacy-ticket:open',
      label:'Manage Legacy Ticket', style:ButtonStyle.Secondary
    }] }],
    allowedMentions:{ parse:[] }
  };
}

function legacyTicketPayload(record, controls = []) {
  const labels = { claim:'Claim Ticket', complete:'Ticket Completed', close:'Close Ticket', reopen:'Reopen Ticket' };
  return {
    content:`**Legacy ticket ${record.id} - ${record.state}**\nType: ${record.type}\nPlayer: ${record.playerName}\n${record.description}\n\nThis is a preserved record, not a private channel. Completion keeps it active; closing makes it eligible for configured retention.`,
    components:controls.length ? [{ type:ComponentType.ActionRow, components:controls.map(({ action, token }) => ({
      type:ComponentType.Button, custom_id:`v2:legacy-ticket:${action}:${token}`,
      label:labels[action], style:action === 'close' ? ButtonStyle.Danger : ButtonStyle.Secondary
    })) }] : [],
    allowedMentions:{ parse:[] }
  };
}

function createTicketsFeature() {
  let listener;
  let readyListener;
  let deleteListener;
  let messageDeleteListener;
  let pendingRecovery;
  let panel;
  let legacyPanel;
  let openPanel;
  let openPage = 1;
  let refreshTimer;
  let unsubscribe;
  let active = false;
  let entries = new Map();
  const modals = new Map();

  function scheduleOpenRefresh(context) {
    if (!active || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void openPanel.refresh(context);
    }, 150);
    refreshTimer.unref?.();
  }

  async function showLegacy(context, interaction, ticketId, messageId) {
    const record = await context.services.tickets.getLegacy({ ticketId, context:toInteractionContext(interaction) });
    if (!messageId) {
      const message = await interaction.editReply(legacyTicketPayload(record));
      messageId = message?.id || (await interaction.fetchReply()).id;
    }
    const view = await context.services.tickets.legacyControls({
      ticketId, context:{ ...toInteractionContext(interaction), messageId }
    });
    return interaction.editReply(legacyTicketPayload(view.record, view.controls));
  }

  return defineFeature({
    name:'tickets',
    dependencies:['player-names'],
    async initialize(context) {
      if (!context.services?.tickets) throw new TypeError('tickets service is required.');
      panel = createPersistentPanel({
        key:'requests', channelId:context.config.discord.channels.requests,
        payload:requestPayload(context.config.features.shop)
      });
      legacyPanel = createPersistentPanel({
        key:'legacy-tickets', channelId:context.config.discord.channels.ticketLogs,
        payload:legacyPanelPayload(), validateChannel:requireStaffChannel
      });
      openPanel = createPersistentPanel({
        key:'open-tickets',channelId:context.config.discord.channels.ticketLogs,
        validateChannel:(channel, current) => requirePrivateStaffChannel(channel, current,
          current.config.discord.channels.ticketLogs),sensitive:true,
        unavailableContent:'Open Tickets unavailable. Staff must verify channel privacy.',
        payload:async () => {
          const result = await context.services.tickets.openSnapshot(openPage);
          openPage = result.page;
          const previous = new Map([...entries].map(([token, record]) => [record.id, token]));
          entries = new Map(result.results.map(record => [previous.get(record.id) || randomUUID(), record]));
          return openTicketsPayload({ ...result,results:[...entries].map(([unclaimToken, record]) => ({ ...record,unclaimToken })) });
        }
      });
      context.services.tickets.connectChannels(createTicketChannelGateway({
        client:context.client, config:context.config,
        onRenameError:error => context.logSink({ type:'discord.ticket.rename_failed', at:new Date().toISOString(),
          data:{ code:typeof error?.code === 'number' ? error.code : null } })
      }));
    },
    async register(context) {
      unsubscribe = context.services.tickets.subscribe(() => scheduleOpenRefresh(context));
      listener = registerInteractionListener(context, 'tickets', async interaction => {
        const open = String(interaction.customId || '').match(/^v2:open-ticket:(unclaim|prev|next):([^:]+)$/);
        if (open && isButton(interaction)) {
          if (!openPanel.matches(interaction)) throw new Error('This Open Tickets panel is no longer valid.');
          const bound = toInteractionContext(interaction, { requireMessage:true });
          context.services.authorization.authorize('tickets.moderate', bound);
          const unclaim = open[1] === 'unclaim';
          if (unclaim) await interaction.deferReply({ flags:MessageFlags.Ephemeral });
          else await interaction.deferUpdate();
          try {
            try {
              const channel = await context.client.channels.fetch(context.config.discord.channels.ticketLogs, { force:true });
              await requirePrivateStaffChannel(channel, context, context.config.discord.channels.ticketLogs);
            } catch (error) {
              await openPanel.refresh(context);
              throw error;
            }
            if (unclaim) {
              const record = entries.get(open[2]);
              if (!record) return respond(interaction, ephemeral('This Open Tickets entry is no longer available.'));
              const result = await context.services.tickets.unclaim({ ticketId:record.id,context:bound });
              scheduleOpenRefresh(context);
              return respond(interaction, ephemeral(result.notice));
            }
            const result = await context.services.tickets.openPage({ page:Number(open[2]),context:bound });
            openPage = result.page;
            return openPanel.refresh(context);
          } catch (error) {
            return reportInteractionError(context, 'tickets', interaction, error, !unclaim);
          }
        }
        if (isButton(interaction) && interaction.customId === 'v2:legacy-ticket:open') {
          if (!legacyPanel.matches(interaction)) throw new Error('This legacy ticket panel is no longer valid.');
          context.services.authorization.authorize('tickets.moderate', toInteractionContext(interaction));
          requireStaffChannel(interaction.channel, context);
          for (const [id, modal] of modals) if (modal.expiresAt <= Date.now()) modals.delete(id);
          while (modals.size >= 500) modals.delete(modals.keys().next().value);
          const id = randomUUID();
          modals.set(id, { ...toInteractionContext(interaction), expiresAt:Date.now() + 120000 });
          return interaction.showModal(new ModalBuilder().setCustomId(`v2:legacy-ticket:lookup:${id}`)
            .setTitle('Manage Legacy Ticket').addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('ticket-id').setLabel('Ticket ID from staff audit records')
                .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(80).setRequired(true))));
        }
        const legacy = String(interaction.customId || '').match(/^v2:legacy-ticket:(lookup|claim|complete|close|reopen):([^:]+)$/);
        if (legacy) {
          const [, action, token] = legacy;
          if (action === 'lookup' && isModal(interaction)) {
            const modal = modals.get(token);
            const current = toInteractionContext(interaction);
            if (!modal || modal.expiresAt <= Date.now() || modal.actorId !== current.actorId
              || modal.guildId !== current.guildId || modal.channelId !== current.channelId
              || !legacyPanel.matches({ guildId:current.guildId, channelId:current.channelId,
                message:{ id:modal.messageId } })) {
              throw new Error('This legacy ticket lookup has expired. Use the panel again.');
            }
            modals.delete(token);
            requireStaffChannel(interaction.channel, context);
            await interaction.deferReply({ flags:MessageFlags.Ephemeral });
            return showLegacy(context, interaction, interaction.fields.getTextInputValue('ticket-id').trim());
          }
          if (action === 'lookup' || !isButton(interaction)) return;
          requireStaffChannel(interaction.channel, context);
          const bound = toInteractionContext(interaction, { requireMessage:true });
          await interaction.deferUpdate();
          const record = await context.services.tickets.legacyAction({ action, token, context:bound });
          return showLegacy(context, interaction, record.id, bound.messageId);
        }
        let action;
        let input;
        if (isButton(interaction) && interaction.customId === 'v2:request:open') {
          if (!panel.matches(interaction)) throw new Error('This request panel is no longer valid.');
          action = 'create';
          input = { type:'SUPPORT', description:'Please describe your request in the private ticket channel.',
            username:interaction.user.username, context:toInteractionContext(interaction) };
        } else if (isButton(interaction) && String(interaction.customId).startsWith('v2:ticket:')) {
          const parts = interaction.customId.split(':');
          if (parts.length !== 4 || !['claim','complete','close','reopen'].includes(parts[2])) return;
          action = parts[2];
          input = { ticketId:parts[3], context:toInteractionContext(interaction, { requireMessage:true }) };
        } else return;
        if (!['create','claim','complete','close','reopen'].includes(action)) return;
        await interaction.deferReply({ flags:MessageFlags.Ephemeral });
        const result = await context.services.tickets[action](input);
        if (action === 'create' && result.channelStatus === 'ACTIVE') {
          return respond(interaction, ephemeral(`Ticket created: <#${result.channelId}>`));
        }
        return respond(interaction, ephemeral(
          action === 'close' ? 'Ticket closed. It remains staff-visible until automatic deletion.'
            : action === 'complete' ? 'Ticket marked completed. The channel remains open.'
              : action === 'claim' ? 'Ticket claimed.' : 'Ticket updated.'));
      });
    },
    async start(context) {
      active = true;
      await Promise.all([panel.start(context), legacyPanel.start(context), openPanel.start(context)]);
      readyListener = () => {
        if (!pendingRecovery) {
          pendingRecovery = context.services.tickets.recoverChannels().catch(async error => {
            const missing = [error, ...(error?.errors || [])].find(item => item?.code === 'TICKET_PERMISSIONS_MISSING')?.missing;
            await context.logSink({ type:'discord.ticket.restore_failed', at:new Date().toISOString(),
              data:missing ? { missingPermissions:missing } : {} });
          }).finally(() => { pendingRecovery = null; });
        }
        return pendingRecovery;
      };
      context.client.on('ready', readyListener);
      deleteListener = channel => context.services.tickets.channelDeleted(channel.id, channel.guildId).catch(async () => {
        await context.logSink({ type:'discord.ticket.delete_failed', at:new Date().toISOString(), data:{} });
      });
      context.client.on('channelDelete', deleteListener);
      messageDeleteListener = message => context.services.tickets.controlDeleted(message.id, message.channelId, message.guildId).catch(async () => {
        await context.logSink({ type:'discord.ticket.controls_restore_failed', at:new Date().toISOString(), data:{} });
      });
      context.client.on('messageDelete', messageDeleteListener);
      if (context.client.isReady?.()) await readyListener();
    },
    async stop(context) {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
      if (unsubscribe) unsubscribe();
      if (listener) context.client.off('interactionCreate', listener);
      if (readyListener) context.client.off('ready', readyListener);
      if (deleteListener) context.client.off('channelDelete', deleteListener);
      if (messageDeleteListener) context.client.off('messageDelete', messageDeleteListener);
      if (panel) await panel.stop(context);
      if (legacyPanel) await legacyPanel.stop(context);
      if (openPanel) await openPanel.stop(context);
      if (pendingRecovery) await pendingRecovery;
      listener = null;
      readyListener = null;
      deleteListener = null;
      messageDeleteListener = null;
      panel = null;
      legacyPanel = null;
      openPanel = null;
      entries.clear();
      modals.clear();
    }
  });
}

module.exports = { createTicketsFeature, requestPayload, legacyPanelPayload, legacyTicketPayload };
