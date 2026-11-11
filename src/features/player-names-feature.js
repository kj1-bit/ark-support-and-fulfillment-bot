'use strict';

const { defineFeature } = require('./feature-contract');
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { isModal, isButton, respond, ephemeral } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { createNameLinkRouter } = require('../adapters/discord/name-link-router');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { requirePrivatePinChannel, fetchPrivatePinChannel } = require('../adapters/discord/staff-pin-channel');
const views = require('../adapters/discord/fulfillment-view');
const nameViews = require('../adapters/discord/name-link-view');

function playerNameModal() {
  return new ModalBuilder().setCustomId('v2:player-name:submit').setTitle('Submit your player name').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('player-name')
      .setLabel('In-game player name').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true)));
}
function createPlayerNamesFeature() {
  let listener, panel, staffPanel, router, changedListener, page = 1;
  return defineFeature({
    name: 'player-names', dependencies: [],
    async initialize(context) {
      if (!context.services?.playerNames) throw new TypeError('playerNames service is required.');
      const channelId = context.config.discord.channels?.playerNames;
      if (!channelId || !context.services.dashboardPanels) {
        throw new TypeError('Player-name panel channel and persistence are required.');
      }
      panel = createPersistentPanel({ key: 'player-names', channelId, payload: views.playerNamesPanelView() });
      const staffChannel = context.config.discord.channels.pinsDashboard;
      if (!staffChannel || !context.services.playerNames.queueRestoration) {
        throw new TypeError('Staff request panel channel and queue are required.');
      }
      staffPanel = createPersistentPanel({ key:'player-name-requests', channelId:staffChannel, sensitive:true,
        validateChannel:requirePrivatePinChannel,
        unavailableContent:'Player name requests unavailable. Staff must verify channel privacy and refresh the panel.',
        payload:async () => nameViews.panel(await context.services.playerNames.queueRestoration(page)) });
      router = createNameLinkRouter(context,staffPanel);
    },
    async register(context) {
      listener = registerInteractionListener(context, 'player-names', async interaction => {
        if (isButton(interaction) && interaction.customId === 'v2:player-name:set') {
          if (!panel?.matches(interaction)) return false;
          const linked = await context.services.playerNames.linkedName(interaction.user.id);
          if (linked) return respond(interaction, { ...ephemeral(
            `You are already linked as **${nameViews.safe(linked.displayName)}**. Ask staff to unlink you if this is wrong.`),
            allowedMentions:{ parse:[] } });
          return interaction.showModal(playerNameModal());
        }
        if (isModal(interaction) && interaction.customId === 'v2:player-name:submit') {
          if (interaction.guildId !== context.config.discord.guildId || interaction.channelId !== context.config.discord.channels.playerNames) {
            throw new Error('This submission is invalid.');
          }
          await context.services.playerNames.submit({ discordId: interaction.user.id,
            playerName: interaction.fields.getTextInputValue('player-name') });
          context.client.emit('v2PlayerNamesChanged');
          context.client.emit('v2VaultPinsChanged');
          return respond(interaction, { ...ephemeral('Player name submitted. Staff will link your in-game character.'), allowedMentions:{ parse:[] } });
        }
        if (isButton(interaction) && ['v2:player-name:link','v2:player-name:unlink','v2:player-name:verify'].includes(interaction.customId)) {
          return respond(interaction, { ...ephemeral('These controls are retired. Staff must use the player name requests panel.'),allowedMentions:{ parse:[] } });
        }
        const paging = String(interaction.customId || '').match(/^v2:name-requests:(previous|next|refresh):(\d+)$/);
        if (isButton(interaction) && paging) {
          if (!staffPanel.matches(interaction)) throw new Error('This staff panel is no longer valid.');
          const user = toInteractionContext(interaction,{ requireMessage:true });
          context.services.authorization.authorize('player-names.verify',user);
          try { await fetchPrivatePinChannel(context); }
          catch (error) { await staffPanel.refresh(context); throw error; }
          await interaction.deferUpdate();
          const result = await context.services.playerNames.queue({ page:Number(paging[2]),context:user });
          page = result.page;
          const body = nameViews.panel(result);
          await interaction.editReply(body);
          staffPanel.notePublished(body,interaction.message.id);
          try { await fetchPrivatePinChannel(context); }
          catch (error) { await staffPanel.refresh(context); throw error; }
          return;
        }
        return router ? router.handle(interaction) : false;
      });
      changedListener = () => { page = 1; return staffPanel.refresh(context); };
      context.client.on('v2PlayerNamesChanged',changedListener);
    },
    async start(context) { await Promise.all([panel.start(context),staffPanel.start(context)]); },
    async stop(context) {
      if (panel) await panel.stop(context);
      if (staffPanel) await staffPanel.stop(context);
      if (listener && typeof context.client.off === 'function') context.client.off('interactionCreate', listener);
      if (changedListener) context.client.off('v2PlayerNamesChanged',changedListener);
      router?.stop();
      listener = panel = staffPanel = router = changedListener = null;
    }
  });
}
module.exports = { createPlayerNamesFeature, playerNameModal };
