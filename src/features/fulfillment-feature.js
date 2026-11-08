'use strict';
const { defineFeature } = require('./feature-contract');
const { createFulfillmentController } = require('../adapters/discord/fulfillment-controller');
const { createDiscordRouter } = require('../adapters/discord/router');
const { registerInteractionListener } = require('../adapters/discord/interaction-listener');
const views = require('../adapters/discord/fulfillment-view');

function createFulfillmentFeature() {
  let listener;
  let router;
  return defineFeature({
    name: 'fulfillment',
    dependencies: [],
    async initialize(context) {
      const controller = createFulfillmentController({ services: context.services });
      router = createDiscordRouter({ controller, views, logSink: context.logSink });
    },
    async register(context) {
      listener = registerInteractionListener(context, 'fulfillment', interaction => router.handle(interaction));
    },
    async start() {},
    async stop(context) {
      if (listener && typeof context.client.off === 'function') {
        context.client.off('interactionCreate', listener);
      }
      listener = null;
      router = null;
    }
  });
}
module.exports = { createFulfillmentFeature };
