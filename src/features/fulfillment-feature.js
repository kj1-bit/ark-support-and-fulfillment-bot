'use strict';
const { defineFeature } = require('./feature-contract');
const { createFulfillmentController } = require('../adapters/discord/fulfillment-controller');
const { createDiscordRouter } = require('../adapters/discord/router');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const views = require('../adapters/discord/fulfillment-view');
const { createPersistentPanel } = require('../adapters/discord/persistent-panel');

function createFulfillmentFeature() {
  let listener;
  let router;
  let panel;
  return defineFeature({
    name: 'fulfillment',
    dependencies: [],
    async initialize(context) {
      const controller = createFulfillmentController({ services: context.services });
      const channelId = context.config.discord.channels?.fulfillment;
      if (!channelId || !context.services.dashboardPanels || !context.services.shop) {
        throw new TypeError('Fulfillment panel channel, persistence, and catalog search service are required.');
      }
      panel = createPersistentPanel({ key: 'fulfillment-panel', channelId, payload: views.fulfillmentPanelView() });
      router = createDiscordRouter({ controller, views, logSink: context.logSink, config: context.config,
        panelMatches: interaction => Boolean(panel?.matches(interaction)),
        handlePlayerLink: context.config.features?.playerNames !== true });
    },
    async register(context) {
      listener = registerInteractionListener(context, 'fulfillment', interaction => router.handle(interaction));
    },
    async start(context) { if (panel) await panel.start(context); },
    async stop(context) {
      if (panel) await panel.stop(context);
      if (listener && typeof context.client.off === 'function') {
        context.client.off('interactionCreate', listener);
      }
      listener = null;
      router?.stop();
      router = null;
      panel = null;
    }
  });
}
module.exports = { createFulfillmentFeature };
