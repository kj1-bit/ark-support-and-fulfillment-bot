'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');
const guildId = '10000000000000002', channelId = '10000000000000003',
  actorId = '10000000000000001', messageId = '10000000000000004';
function setup(features = { shop: true, tickets: false }) {
  const listeners = new Map(), sent = [], edited = [], searches = [];
  let saved, fetches = 0;
  const message = { id: messageId, edit: async payload => { edited.push(payload); return message; } };
  const client = {
    isReady: () => true,
    on: (event, callback) => listeners.set(event, [...(listeners.get(event) || []), callback]),
    off: (event, callback) => listeners.set(event, listeners.get(event).filter(value => value !== callback)),
    login: async () => {}, destroy: async () => {},
    channels: { fetch: async () => { fetches++; return { guildId,
      send: async payload => { sent.push(payload); return message; },
      messages: { fetch: async id => { assert.equal(id, messageId); return message; } }
    }; } }
  };
  const services = { dashboardPanels: { get: async key => { assert.equal(key, 'requests'); return saved; },
    save: async record => { saved = record; } },
  shop: { search: async input => { searches.push(input); return {
    page: 1, pageSize: 10, total: 1, results: [{ id: 'rex', name: 'Rex' }]
  }; } } };
  const adapter = () => createDiscordAdapter({ client, services,
    config: { features, discord: { tokenSecret: 'DISCORD_TOKEN', guildId, channels: { requests: channelId } } },
    env: { DISCORD_TOKEN: 'fixture' } });
  return { adapter, listeners, sent, edited, searches, saved: () => saved, fetches: () => fetches };
}
function interaction(kind, customId, overrides = {}) {
  const replies = [];
  const i = { replies, customId, user: { id: actorId }, guildId, channelId,
    message: { id: messageId }, isButton: () => kind === 'button',
    isChatInputCommand: () => false, isModalSubmit: () => kind === 'modal',
    showModal: async modal => { replies.push(modal.toJSON()); },
    fields: { getTextInputValue: () => 'rex' }, reply: async payload => replies.push(payload),
    deferReply: async payload => { i.deferred = true; i.deferPayload = payload; },
    editReply: async payload => { replies.push(payload); return { id: 'private-message' }; }, ...overrides };
  return i;
}
async function dispatch(state, i) {
  for (const listener of state.listeners.get('interactionCreate') || []) await listener(i);
}
test('shop-only ready posts persistent requests search panel without disabled ticket controls', async () => {
  const state = setup();
  const adapter = state.adapter();
  await adapter.start();
  assert.equal(state.sent.length, 1);
  assert.equal(state.saved().panelKey, 'requests');
  const buttons = state.sent[0].components[0].components;
  assert.deepEqual(buttons.map(button => button.label), ['Search In-Game Shop']);
  assert.equal(buttons[0].custom_id, 'v2:shop:search');
  assert(!JSON.stringify(state.sent).includes('Open Request'));
  const launch = interaction('button', buttons[0].custom_id);
  await dispatch(state, launch);
  assert.equal(launch.replies[0].title, 'Search In-Game Shop');
  const submit = interaction('modal', launch.replies[0].custom_id, { message: undefined });
  await dispatch(state, submit);
  assert.equal(submit.deferPayload.flags, 64);
  assert.match(submit.replies[0].content, /Rex/);
  assert.deepEqual(state.searches, [{ query: 'rex', page: 1 }]);
  await adapter.stop();
  for (const listeners of state.listeners.values()) assert.equal(listeners.length, 0);
});
test('shop-only restart restores same requests message rather than posting another panel', async () => {
  const state = setup();
  let adapter = state.adapter();
  await adapter.start();
  await adapter.stop();
  adapter = state.adapter();
  await adapter.start();
  assert.equal(state.sent.length, 1);
  assert.equal(state.edited.length, 1);
  const valid = interaction('button', 'v2:shop:search');
  await dispatch(state, valid);
  assert.equal(valid.replies[0].title, 'Search In-Game Shop');
  for (const overrides of [{ message: { id: 'copied' } }, { guildId: actorId }, { channelId: actorId }]) {
    const invalid = interaction('button', 'v2:shop:search', overrides);
    await dispatch(state, invalid);
    assert.equal(invalid.replies.length, 0);
  }
  await adapter.stop();
});
test('disabled shop and tickets register no panels or network calls', async () => {
  const state = setup({ shop: false, tickets: false });
  const adapter = state.adapter();
  await adapter.start();
  await adapter.stop();
  assert.equal(state.fetches(), 0);
  assert.equal(state.sent.length, 0);
  assert.equal(state.listeners.size, 0);
});
test('shop-only startup fails closed when requests persistence or channel is missing', async () => {
  const adapter = createDiscordAdapter({ client: { on() {}, off() {}, login: async () => {}, destroy: async () => {} },
    config: { features: { shop: true }, discord: {} }, services: { shop: {} } });
  await assert.rejects(adapter.start(), /Shop-only requests panel channel and persistence/);
});
