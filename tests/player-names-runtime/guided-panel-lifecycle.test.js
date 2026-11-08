'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');
const guildId = '10000000000000002', playerChannelId = '10000000000000003',
  fulfillmentChannelId = '10000000000000004', actorId = '10000000000000001';

function setup() {
  const saved = new Map(), messages = new Map(), listeners = new Map(), sent = [], edited = [];
  const client = {
    isReady: () => true,
    on: (event, callback) => { const callbacks = listeners.get(event) || []; callbacks.push(callback); listeners.set(event, callbacks); },
    off: (event, callback) => listeners.set(event, (listeners.get(event) || []).filter(value => value !== callback)),
    login: async () => {}, destroy: async () => {},
    channels: { fetch: async channelId => ({ guildId,
      messages: { fetch: async messageId => messages.get(messageId) },
      send: async payload => {
        const id = `10000000000000${String(sent.length + 100).padStart(3, '0')}`;
        const message = { id, edit: async body => { edited.push(body); return message; } };
        messages.set(id, message);
        sent.push({ id, channelId, payload });
        return message;
      }
    }) }
  };
  const services = { authorization: { authorize() {} }, interactionGuard: {}, fulfillment: {}, onlinePlayers: {},
    catalogManager: {}, shop: {},
    playerNames: { submit: async () => ({}), verify: async () => ({}) },
    dashboardPanels: { get: async key => saved.get(key), save: async record => { saved.set(record.panelKey, record); } } };
  const config = { features: { playerNames: true, fulfillment: true },
    discord: { tokenSecret: 'DISCORD_TOKEN', guildId, channels: {
      playerNames: playerChannelId, fulfillment: fulfillmentChannelId } } };
  const adapter = () => createDiscordAdapter({ client, services, config, env: { DISCORD_TOKEN: 'fixture' } });
  async function dispatch(interaction) {
    for (const callback of listeners.get('interactionCreate') || []) await callback(interaction);
  }
  return { adapter, saved, sent, edited, listeners, dispatch };
}
test('player-name and Dino Fulfillment standing panels persist, restore instead of duplicate, and stop listeners', async () => {
  const state = setup();
  let adapter = state.adapter();
  await adapter.start();
  assert.equal(state.sent.length, 2);
  assert(state.saved.has('player-names'));
  assert(state.saved.has('fulfillment-panel'));
  assert(!state.saved.has('fulfillment'), 'Keep the logs dashboard persistence key separate.');
  await adapter.stop();
  for (const callbacks of state.listeners.values()) assert.equal(callbacks.length, 0);
  adapter = state.adapter();
  await adapter.start();
  assert.equal(state.sent.length, 2);
  assert.equal(state.edited.length, 2);
  await adapter.stop();
});
test('Set My In-Game Name reaches existing modal only from active persisted panel in configured guild', async () => {
  const state = setup();
  const adapter = state.adapter();
  await adapter.start();
  const messageId = state.saved.get('player-names').messageId;
  const modals = [];
  const base = { customId: 'v2:player-name:set', user: { id: actorId }, guildId, channelId: playerChannelId,
    message: { id: messageId }, isButton: () => true, isChatInputCommand: () => false,
    showModal: async modal => modals.push(modal.toJSON()) };
  await state.dispatch({ ...base, message: { id: 'copied' } });
  await state.dispatch({ ...base, guildId: actorId });
  await state.dispatch(base);
  assert.equal(modals.length, 1);
  assert.equal(modals[0].custom_id, 'v2:player-name:submit');
  await adapter.stop();
});
