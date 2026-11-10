'use strict';

const { randomUUID } = require('node:crypto');
const { ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton, isModal, respond, ephemeral } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener, reportInteractionError } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { createTicketChannelGateway } = require('../adapters/discord/ticket-channel-gateway');
const { openTicketsPayload } = require('../adapters/discord/ticket-view');
const { requirePrivateStaffChannel } = require('../adapters/discord/staff-pin-channel');

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

async function removeRetiredLegacyPanel(context) {
  let phase = 'binding';
  try {
    const saved = await context.services.dashboardPanels.get('legacy-tickets');
    if (!saved) return;
    phase = 'channel';
    const discord = context.config.discord;
    if (saved.channelId !== discord.channels.ticketLogs) throw new Error('Legacy panel channel binding does not match.');
    const channel = await context.client.channels.fetch(saved.channelId, { force:true });
    if (!channel || channel.id !== saved.channelId || channel.guildId !== discord.guildId) {
      throw new Error('Legacy panel channel identity could not be verified.');
    }
    phase = 'message';
    let message;
    let missing = false;
    try { message = await channel.messages.fetch(saved.messageId); }
    catch (error) {
      if (error?.code !== 10008) throw error;
      missing = true;
    }
    if (!message && !missing) throw new Error('Legacy panel message could not be verified.');
    if (message) {
      phase = 'ownership';
      if (message.id !== saved.messageId || !message.author?.id
        || message.author.id !== context.client.user?.id
        || message.channelId !== saved.channelId || message.guildId !== discord.guildId) {
        throw new Error('Legacy panel message ownership could not be verified.');
      }
      phase = 'delete';
      try { await message.delete(); }
      catch (error) { if (error?.code !== 10008) throw error; }
    }
    phase = 'forget';
    await context.services.dashboardPanels.remove(saved);
  } catch {
    try {
      await context.logSink({ type:'discord.ticket.legacy_panel_cleanup_failed',
        at:new Date().toISOString(),data:{ phase } });
    } catch {
      console.error('Retired legacy ticket panel cleanup failure could not be logged.');
    }
  }
}

function createTicketsFeature() {
  let listener;
  let readyListener;
  let deleteListener;
  let messageDeleteListener;
  let pendingRecovery;
  let panel;
  let openPanel;
  let openPage = 1;
  let refreshTimer;
  let unsubscribe;
  let active = false;
  let entries = new Map();

  function scheduleOpenRefresh(context) {
    if (!active || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void openPanel.refresh(context);
    }, 150);
    refreshTimer.unref?.();
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
        if (String(interaction.customId || '').startsWith('v2:legacy-ticket:')
          && (isButton(interaction) || isModal(interaction))) {
          return respond(interaction, ephemeral('Legacy ticket management has been removed. Use Open Tickets for current assignments.'));
        }
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
      await Promise.all([panel.start(context), openPanel.start(context)]);
      readyListener = () => {
        if (!pendingRecovery) {
          pendingRecovery = removeRetiredLegacyPanel(context)
            .then(() => context.services.tickets.recoverChannels()).catch(async error => {
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
      if (openPanel) await openPanel.stop(context);
      if (pendingRecovery) await pendingRecovery;
      listener = null;
      readyListener = null;
      deleteListener = null;
      messageDeleteListener = null;
      panel = null;
      openPanel = null;
      entries.clear();
    }
  });
}

module.exports = { createTicketsFeature, requestPayload };
