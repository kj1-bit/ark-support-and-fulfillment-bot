'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deepFreeze } = require('../../src/config');
const { startApplication } = require('../../src/bootstrap/start-application');

function config(mode = 'mock') {
  return deepFreeze({
    schemaVersion: 1,
    runtime: { mode, environment: 'test', logLevel: 'info' },
    discord: { clientId: '10000000000000001', guildId: '10000000000000002', tokenSecret: 'DISCORD_TOKEN', roles: {}, channels: {} },
    ark: { timeoutMs: 10000, servers: [] },
    storage: { databasePath: './runtime/test.sqlite', backupPath: './runtime/backups' },
    features: { tickets: false, pins: false, playerNames: false, shop: false, fulfillment: false }
  });
}

test('configuration failure prevents all external initialization', async () => {
  let discordCreated = 0;
  let rconCreated = 0;
  await assert.rejects(
    startApplication({
      loadConfig() { throw new Error('invalid configuration'); },
      createDiscordAdapter() { discordCreated += 1; },
      createRconAdapter() { rconCreated += 1; }
    }),
    /invalid configuration/
  );
  assert.equal(discordCreated, 0);
  assert.equal(rconCreated, 0);
});

test('mock mode never constructs RCON and starts Discord with frozen config', async () => {
  const loaded = config('mock');
  let started = 0;
  let discordInput;
  const result = await startApplication({
    loadConfig: () => loaded,
    env: {},
    createRconAdapter() { throw new Error('RCON must not be constructed in mock mode'); },
    createDiscordAdapter(input) {
      discordInput = input;
      return { async start() { started += 1; } };
    }
  });
  assert.equal(started, 1);
  assert.equal(discordInput.rcon, null);
  assert.equal(discordInput.config, loaded);
  assert(Object.isFrozen(discordInput.config));
  assert.equal(result.config, loaded);
});

test('test mode constructs RCON before Discord and passes the same frozen config', async () => {
  const loaded = config('test');
  const order = [];
  const rcon = { kind: 'rcon' };
  let discordInput;
  await startApplication({
    loadConfig: () => loaded,
    env: {},
    createRconAdapter({ config: input }) { order.push('rcon'); assert.equal(input, loaded); return rcon; },
    createDiscordAdapter(input) { order.push('discord'); discordInput = input; return { async start() { order.push('start'); } }; }
  });
  assert.deepEqual(order, ['rcon', 'discord', 'start']);
  assert.equal(discordInput.rcon, rcon);
  assert.equal(discordInput.config, loaded);
});

test('safe summary is emitted before external adapter construction', async () => {
  const loaded = config('mock');
  const order = [];
  await startApplication({
    loadConfig: () => loaded,
    env: { DISCORD_TOKEN: 'must-not-appear' },
    writeSummary(summary) { order.push('summary'); assert.equal(summary.discord.tokenPresent, true); assert(!JSON.stringify(summary).includes('must-not-appear')); },
    createDiscordAdapter() { order.push('discord'); return { async start() { order.push('start'); } }; }
  });
  assert.deepEqual(order, ['summary', 'discord', 'start']);
});
