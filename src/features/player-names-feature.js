'use strict';

const { defineFeature } = require('./feature-contract');
const { toInteractionContext } = require('../adapters/discord/interaction-context');
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { isChatInput, isModal, isButton, respond, safePublicRecord } = require('../adapters/discord/interaction-protocol');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');
const { createFulfillmentController } = require('../adapters/discord/fulfillment-controller');
const { createDiscordRouter } = require('../adapters/discord/router');
const views = require('../adapters/discord/fulfillment-view');

function playerNameModal() {
  return new ModalBuilder().setCustomId('v2:player-name:submit').setTitle('Submit your player name').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('player-name')
      .setLabel('In-game player name').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true)));
}
function createPlayerNamesFeature() {
  let listener, panel, router;
  return defineFeature({
    name: 'player-names', dependencies: [],
    async initialize(context) {
      if (!context.services?.playerNames) throw new TypeError('playerNames service is required.');
      const channelId = context.config.discord.channels?.playerNames;
      if (!channelId || !context.services.dashboardPanels) {
        throw new TypeError('Player-name panel channel and persistence are required.');
      }
      panel = createPersistentPanel({ key: 'player-names', channelId, payload: views.playerNamesPanelView() });
      router = createDiscordRouter({ controller: createFulfillmentController({ services: context.services }),
        views, logSink: context.logSink, config: context.config, handleFulfillment: false,
        playerPanelMatches: interaction => Boolean(panel?.matches(interaction)) });
    },
    async register(context) {
      listener = registerInteractionListener(context, 'player-names', async interaction => {
        if (isButton(interaction) && interaction.customId === 'v2:player-name:set') {
          if (!panel?.matches(interaction)) return false;
          return interaction.showModal(playerNameModal());
        }
        if (isModal(interaction) && interaction.customId === 'v2:player-name:submit') {
          const result = await context.services.playerNames.submit({ discordId: interaction.user.id,
            playerName: interaction.fields.getTextInputValue('player-name') });
          return respond(interaction, safePublicRecord(result, 'Player name submitted.'));
        }
        if (isChatInput(interaction) && interaction.commandName === 'player-name'
          && interaction.options.getSubcommand() === 'submit') return interaction.showModal(playerNameModal());
        if (isChatInput(interaction) && interaction.commandName === 'player-name-verify') {
          const result = await context.services.playerNames.verify({
            discordId: interaction.options.getString('discord-id', true), moderatorId: interaction.user.id,
            context: toInteractionContext(interaction) });
          return respond(interaction, safePublicRecord(result, 'Player name verified.'));
        }
        return router ? router.handle(interaction) : false;
      });
    },
    async start(context) { if (panel) await panel.start(context); },
    async stop(context) {
      if (panel) await panel.stop(context);
      if (listener && typeof context.client.off === 'function') context.client.off('interactionCreate', listener);
      router?.stop();
      listener = panel = router = null;
    }
  });
}
module.exports = { createPlayerNamesFeature, playerNameModal };
