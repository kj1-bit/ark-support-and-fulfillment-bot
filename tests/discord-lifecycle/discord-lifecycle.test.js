'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCustomId, createDiscordRouter } = require('../../src/adapters/discord/router');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');
const views = require('../../src/adapters/discord/fulfillment-view');
function services() {
  return { authorization: {}, interactionGuard: {}, fulfillment: {}, players: {}, onlinePlayers: {},
    catalogManager: {}, shop: {}, dashboardPanels: { get: async () => null, save: async () => {} } };
}
function config() {
  return { features: { fulfillment: true },
    discord: { tokenSecret: 'DISCORD_TOKEN', channels: { fulfillment: '10000000000000003' } } };
}
test('custom IDs fail closed and expose only opaque token', () => {
  assert.deepEqual(parseCustomId('v2:fulfillment:confirm:opaque'), { action: 'confirm', token: 'opaque' });
  for (const value of ['', 'v1:x', 'v2:fulfillment:raw:cmd', 'v2:fulfillment:confirm:token:req']) {
    assert.equal(parseCustomId(value), null);
  }
});
test('adapter resolves the configured token secret for login without storing it in config', async () => {
  const calls = [];
  const client = { on: (e, f) => calls.push(['on', e, f]), off: (e, f) => calls.push(['off', e, f]),
    login: async token => calls.push(['login', token]), destroy: async () => calls.push(['destroy']) };
  const input = config();
  const adapter = createDiscordAdapter({ client, config: input, env: { DISCORD_TOKEN: 'secret' }, services: services() });
  await adapter.start();
  await assert.rejects(() => adapter.start(), /already started/);
  await adapter.stop();
  assert.equal(calls.find(x => x[0] === 'login')[1], 'secret');
  assert.equal(Object.hasOwn(input.discord, 'token'), false);
  assert.deepEqual(calls.map(x => x[0]), ['on', 'on', 'on', 'on', 'login', 'off', 'off', 'off', 'off', 'destroy']);
});
test('enabled adapter fails closed and destroys the client when configured token secret is missing', async () => {
  const calls = [];
  const client = { on: (e, f) => calls.push(['on', e, f]), off: (e, f) => calls.push(['off', e, f]),
    login: async () => calls.push(['login']), destroy: async () => calls.push(['destroy']) };
  const adapter = createDiscordAdapter({ client, config: config(), env: {}, services: services() });
  await assert.rejects(() => adapter.start(), /token secret is unavailable/);
  assert.deepEqual(calls.map(x => x[0]), ['on', 'on', 'on', 'on', 'off', 'off', 'off', 'off', 'destroy']);
});
test('disabled fulfillment feature causes no Discord registration or network activity', async () => {
  let touched = false;
  const client = { on: () => { touched = true; }, login: async () => { touched = true; },
    destroy: async () => { touched = true; } };
  const adapter = createDiscordAdapter({ client, config: { features: { fulfillment: false } }, services: {} });
  await adapter.start();
  assert.equal(touched, false);
});
test('router evicts old abandoned selection flows when its bound is reached', async () => {
  let next = 0;
  const controller = { authorize() {}, catalog: () => ({ version: 'v1' }),
    search: async () => ({ query: '', page: 1, pageSize: 25, total: 0, catalogVersion: 'v1', results: [] }) };
  const router = createDiscordRouter({ controller, views, logSink: async () => {},
    uuid: () => `flow-${++next}`, panelMatches: () => true });
  for (let index = 0; index < 501; index++) {
    await router.handle({ customId: 'v2:fulfillment:browse', user: { id: '10000000000000001' },
      guildId: '10000000000000002', channelId: '10000000000000003',
      isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false,
      deferReply: async () => {}, editReply: async () => ({ id: '10000000000000004' }) });
  }
  const replies = [];
  await router.handle({ customId: 'v2:fulfillment:select:flow-1', user: { id: '10000000000000001' },
    guildId: '10000000000000002', channelId: '10000000000000003', values: ['player-ref'],
    isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => true,
    deferred: false, replied: false, reply: async payload => replies.push(payload) });
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /no longer valid/);
});
