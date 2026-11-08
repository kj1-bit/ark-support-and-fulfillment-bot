'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');
function baseServices() {
  return { authorization: { authorize() {} }, interactionGuard: { issue: async () => ({ token: 't', expiresAt: 1 }) },
    fulfillment: { createPending: async () => ({ id: 'r' }), confirm: async () => ({ id: 'r', state: 'SUCCEEDED' }) },
    players: { byDiscord: () => null }, onlinePlayers: {},
    catalogManager: { current: () => ({ version: '1', get: () => ({ id: 'rex', name: 'Rex' }) }) },
    playerNames: { submit: async x => x, verify: async x => x },
    dashboardPanels: { get: async () => null, save: async () => {} } };
}
test('player-name feature is enabled through camel-case configuration mapping', async () => {
  const calls = [];
  const client = { on: (e, f) => calls.push(['on', e, f]), off: (e, f) => calls.push(['off', e, f]),
    login: async () => calls.push(['login']), destroy: async () => calls.push(['destroy']) };
  const adapter = createDiscordAdapter({ client,
    config: { features: { fulfillment: false, playerNames: true },
      discord: { tokenSecret: 'DISCORD_TOKEN', channels: { playerNames: '10000000000000003' } } },
    env: { DISCORD_TOKEN: 'x' }, services: baseServices() });
  assert.deepEqual(adapter.featureNames, ['player-names']);
  await adapter.start();
  await adapter.stop();
  assert.deepEqual(calls.map(x => x[0]), ['on', 'on', 'on', 'login', 'off', 'off', 'off', 'destroy']);
});
test('disabled player names register no feature', () => {
  const client = { on() {}, login: async () => {}, destroy: async () => {} };
  const adapter = createDiscordAdapter({ client,
    config: { features: { fulfillment: false, playerNames: false }, discord: { tokenSecret: 'DISCORD_TOKEN' } },
    env: {}, services: {} });
  assert.deepEqual(adapter.featureNames, []);
});
test('enabled player-name onboarding requires persistent panel configuration', async () => {
  const client = { on() {}, off() {}, login: async () => {}, destroy: async () => {} };
  const adapter = createDiscordAdapter({ client, config: { features: { playerNames: true }, discord: {} },
    services: baseServices() });
  await assert.rejects(adapter.start(), /panel channel and persistence/);
});
