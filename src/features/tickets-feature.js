'use strict';

const { ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { isButton, isChatInput, respond, safePublicRecord, ephemeral } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { createTicketChannelGateway } = require('../adapters/discord/ticket-channel-gateway');

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

function createTicketsFeature() {
  let listener;
  let readyListener;
  let deleteListener;
  let messageDeleteListener;
  let pendingRecovery;
  let panel;
  return defineFeature({
    name:'tickets',
    dependencies:['player-names'],
    async initialize(context) {
      if (!context.services?.tickets) throw new TypeError('tickets service is required.');
      panel = createPersistentPanel({
        key:'requests', channelId:context.config.discord.channels.requests,
        payload:requestPayload(context.config.features.shop)
      });
      context.services.tickets.connectChannels(createTicketChannelGateway({
        client:context.client, config:context.config,
        onRenameError:error => context.logSink({ type:'discord.ticket.rename_failed', at:new Date().toISOString(),
          data:{ code:typeof error?.code === 'number' ? error.code : null } })
      }));
    },
    async register(context) {
      listener = registerInteractionListener(context, 'tickets', async interaction => {
        let action;
        let input;
        if (isChatInput(interaction) && interaction.commandName === 'ticket') {
          action = interaction.options.getSubcommand();
          input = { context:toInteractionContext(interaction) };
          if (action === 'create') {
            input.type = interaction.options.getString('type', true);
            input.description = interaction.options.getString('description', true);
            input.username = interaction.user.username;
          } else input.ticketId = interaction.options.getString('ticket-id', true);
        } else if (isButton(interaction) && interaction.customId === 'v2:request:open') {
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
        return respond(interaction, safePublicRecord(result,
          action === 'close' ? 'Ticket closed. It remains staff-visible until automatic deletion.'
            : action === 'complete' ? 'Ticket marked completed. The channel remains open.' : 'Ticket updated.'));
      });
    },
    async start(context) {
      await panel.start(context);
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
      if (listener) context.client.off('interactionCreate', listener);
      if (readyListener) context.client.off('ready', readyListener);
      if (deleteListener) context.client.off('channelDelete', deleteListener);
      if (messageDeleteListener) context.client.off('messageDelete', messageDeleteListener);
      if (panel) await panel.stop(context);
      if (pendingRecovery) await pendingRecovery;
      listener = null;
      readyListener = null;
      deleteListener = null;
      messageDeleteListener = null;
      panel = null;
    }
  });
}

module.exports = { createTicketsFeature, requestPayload };
