'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRconTransport, parseOnlinePlayers } = require('../../src/adapters/rcon/tcp-transport');
const { loadInitialCatalog } = require('../../src/composition/load-initial-catalog');
const { createDefaultDiscordClient, createLauncherOptions, startV2Service } = require('../../scripts/start-v2');
const { GatewayIntentBits, Partials } = require('discord.js');
const { extractPlayers, normalizeObservedPlayer } = require('../../src/application/online-player-selection-service');
const { validateConfig } = require('../../src/config/validate-config');
const { createCreatureRegistry } = require('../../src/registries/creature-registry');

test('catalog loader creates a deterministic content-addressed V2 version', () => {
  const catalogPath = path.resolve(__dirname, '../../data/dino-catalog.json');
  const first = loadInitialCatalog(catalogPath);
  const second = loadInitialCatalog(catalogPath);
  assert.match(first.version, /^2026\.1\.0-[a-f0-9]{16}$/);
  assert.equal(first.version, second.version);
  assert(first.creatures.length > 0);
  assert(first.creatures.every(creature => creature.enabled && creature.tameable));
  assert.equal(createCreatureRegistry(first).version, first.version);
});

test('mock launcher requires a Discord token before SQLite opens when a feature is enabled', () => {
  const config = {
    discord: { tokenSecret: 'DISCORD_TOKEN' },
    features: { shop: true }
  };
  const options = createLauncherOptions({ env: {}, loadConfig: () => config });
  assert.throws(
    () => options.loadConfig({}),
    error => error.code === 'CONFIGURATION_INVALID' && error.issues[0].includes('tokenSecret')
  );
});

test('mock players are accepted by the online-player selection normalizer', async () => {
  const transport = createRconTransport({ mode: 'mock', env: {} });
  const result = await transport.execute({ type: 'listOnlinePlayers', server: { id: 'test-map' } });
  const players = extractPlayers(result).map(normalizeObservedPlayer);
  assert.equal(players.length, 1);
  assert.equal(players[0].displayName, 'Mock Test Player');
});

test('live RCON ignores late socket errors, fails fast on a closed connection, and treats empty replies as accepted', async () => {
  const server = { id: 'test-map', host: 'test.invalid', port: 27020, passwordSecret: 'ARK_SECRET' };
  const env = { ARK_SECRET: 'secret' };
  const operation = { type: 'fulfillApprovedCreature', server, operation: { command: 'internal' } };

  class LateErrorRcon extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('auth')); }
    send() {
      queueMicrotask(() => this.emit('response', ''));
    }
    disconnect() { queueMicrotask(() => this.emit('error', new Error('ECONNRESET'))); }
  }
  const accepted = await createRconTransport({ mode: 'test', env, timeoutMs: 1000, RconClass: LateErrorRcon }).execute(operation);
  assert.deepEqual(accepted, { success: true });
  await new Promise(resolve => setImmediate(resolve));

  class ClosingRcon extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('end')); }
    disconnect() {}
  }
  await assert.rejects(
    createRconTransport({ mode: 'test', env, timeoutMs: 1000, RconClass: ClosingRcon }).execute(operation),
    /connection closed for server test-map/
  );

  class RejectingRcon extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('auth')); }
    send() { queueMicrotask(() => this.emit('response', 'Error: unknown command')); }
    disconnect() {}
  }
  assert.deepEqual(
    await createRconTransport({ mode: 'test', env, timeoutMs: 1000, RconClass: RejectingRcon }).execute(operation),
    { success: false }
  );
});

test('default Discord client can observe message deletions of uncached panels', () => {
  const client = createDefaultDiscordClient();
  try {
    assert(client.options.intents.has(GatewayIntentBits.Guilds));
    assert(client.options.intents.has(GatewayIntentBits.GuildMessages));
    assert(client.options.partials.includes(Partials.Message));
  } finally {
    void client.destroy();
  }
});

test('launcher requires the PIN protection key before SQLite opens when PINs are enabled', () => {
  const config = { discord: { tokenSecret: 'DISCORD_TOKEN' }, features: { pins: true } };
  const options = createLauncherOptions({ env: { DISCORD_TOKEN: 'token' }, loadConfig: () => config });
  assert.throws(
    () => options.loadConfig({}),
    error => error.code === 'CONFIGURATION_INVALID' && error.issues.some(issue => issue.includes('PIN_PROTECTION_KEY'))
  );
});

test('malformed PIN protection keys fail before SQLite or any runtime directory is created', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketbot-v2-pinkey-'));
  const configPath = path.join(root, 'instance.json');
  const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/examples/instance.example.json'), 'utf8'));
  example.storage = { databasePath: 'runtime/database.sqlite', backupPath: 'runtime/backups' };
  fs.writeFileSync(configPath, JSON.stringify(example));
  const badKey = 'not-a-valid-key-but-long-enough-to-pass-a-length-check-0123456789';
  const logs = [];
  let opened = false;
  const errors = [];

  try {
    for (const key of [badKey, Buffer.alloc(16, 7).toString('base64').padEnd(44, 'A')]) {
      await assert.rejects(
        startV2Service({
          sourceRoot: root,
          configPath,
          env: { DISCORD_TOKEN: 'token', PIN_PROTECTION_KEY: key },
          write: line => logs.push(line),
          sqlite3: { Database: function Database() { opened = true; } }
        }),
        error => {
          errors.push(error);
          return error.code === 'CONFIGURATION_INVALID';
        }
      );
      assert.equal(opened, false);
      assert.equal(fs.existsSync(path.join(root, 'runtime')), false);
      const visible = JSON.stringify(errors.at(-1).issues) + logs.join('\n');
      assert(!visible.includes(key));
      assert(errors.at(-1).issues.some(issue => issue.includes('PIN_PROTECTION_KEY')));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production storage paths are checked against the source root, not the working directory', () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/examples/instance.example.json'), 'utf8'));
  config.runtime.mode = 'production';
  config.ark.servers[0] = { ...config.ark.servers[0], id: 'live-map', host: 'rcon.live.net', testOnly: false };
  config.storage = { databasePath: 'runtime/database.sqlite', backupPath: '/var/backups/ticketbot-v2' };
  const env = { DISCORD_TOKEN: 'x', ARK_TEST_RCON_PASSWORD: 'x', PIN_PROTECTION_KEY: 'x' };
  assert.throws(
    () => validateConfig(config, { env, sourceRoot: path.resolve(os.tmpdir(), 'release') }),
    error => error.issues.some(issue => issue.includes('databasePath') && issue.includes('outside source repository'))
  );
  assert.doesNotThrow(() => validateConfig(
    { ...config, storage: { databasePath: '/var/lib/ticketbot-v2/database.sqlite', backupPath: '/var/backups/ticketbot-v2' } },
    { env, sourceRoot: path.resolve(os.tmpdir(), 'release') }
  ));
});

test('a changed shipped catalog is activated on restart instead of being ignored', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketbot-v2-catalog-'));
  const configPath = path.join(root, 'instance.json');
  const source = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/dino-catalog.json'), 'utf8'));
  const catalogPath = path.join(root, 'catalog.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    runtime: { mode: 'mock', environment: 'catalog-test', logLevel: 'error' },
    discord: {
      clientId: '10000000000000001', guildId: '10000000000000002', tokenSecret: 'DISCORD_TOKEN',
      roles: { staff: null, member: null, fulfillmentModerator: null },
      channels: { ticketCategory: null, vault: null, requests: null, playerNames: null, pinsDashboard: null, ticketLogs: null, fulfillment: null, fulfillmentLogs: null }
    },
    ark: { timeoutMs: 1000, servers: [{ id: 'test-map', name: 'Test Map', host: '127.0.0.1', port: 27020, passwordSecret: 'ARK_SECRET', enabled: true, testOnly: true, operations: ['listOnlinePlayers'] }] },
    storage: { databasePath: 'runtime/database.sqlite', backupPath: 'runtime/backups' },
    features: { tickets: false, pins: false, playerNames: false, shop: false, fulfillment: false, dashboards: false }
  }));
  const start = () => startV2Service({
    sourceRoot: root, configPath, catalogPath, env: {}, write: () => {},
    createDiscordClient: () => ({ on() {}, off() {}, login: async () => {}, destroy: async () => {} })
  });

  try {
    fs.writeFileSync(catalogPath, JSON.stringify(source));
    const first = await start();
    const firstVersion = first.runtime.catalogManager.current().version;
    await first.stop();

    const changed = source.map(creature => creature.id === 'rex' ? { ...creature, name: 'Rex (renamed)' } : creature);
    fs.writeFileSync(catalogPath, JSON.stringify(changed));
    const second = await start();
    try {
      const active = second.runtime.catalogManager.current();
      assert.notEqual(active.version, firstVersion);
      assert.equal(active.get('rex').name, 'Rex (renamed)');
    } finally {
      await second.stop();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ListPlayers parsing returns normalized identities and rejects unknown response formats', () => {
  assert.deepEqual(parseOnlinePlayers('1. Test Survivor, 0123456789ABCDEF0123456789ABCDEF'), [
    { displayName: 'Test Survivor', eosId: '0123456789abcdef0123456789abcdef' }
  ]);
  assert.deepEqual(parseOnlinePlayers('No Players Connected'), []);
  assert.throws(() => parseOnlinePlayers('unexpected RCON response'), /could not be parsed/);
});

test('mock RCON transport is deterministic and does not resolve or connect secrets', async () => {
  const transport = createRconTransport({ mode: 'mock', env: {} });
  const server = { id: 'test-map', host: '127.0.0.1', port: 27020, passwordSecret: 'MISSING_SECRET' };
  assert.equal((await transport.execute({ type: 'listOnlinePlayers', server }))[0].eosId,
    '0123456789abcdef0123456789abcdef');
  assert.deepEqual(await transport.execute({
    type: 'fulfillApprovedCreature', server, operation: { command: 'internal allowlisted command' }
  }), { success: true });
});

test('live RCON resolves configured secret, sends only named operations, and redacts transport errors', async () => {
  const calls = [];
  class FakeRcon extends EventEmitter {
    constructor(host, port, password, options) {
      super();
      calls.push({ host, port, password, options });
    }
    connect() { queueMicrotask(() => this.emit('auth')); }
    send(command) {
      calls.push({ command });
      queueMicrotask(() => this.emit('response', '1. Live Player, 0123456789abcdef0123456789abcdef'));
    }
    disconnect() {}
  }
  const server = { id: 'test-map', host: 'test.invalid', port: 27020, passwordSecret: 'ARK_SECRET' };
  const transport = createRconTransport({
    mode: 'test', env: { ARK_SECRET: 'do-not-log-this' }, timeoutMs: 1000, RconClass: FakeRcon
  });
  const players = await transport.execute({ type: 'listOnlinePlayers', server });
  assert.equal(players[0].displayName, 'Live Player');
  assert.equal(calls[0].password, 'do-not-log-this');
  assert.deepEqual(calls[1], { command: 'ListPlayers' });

  class FailingRcon extends EventEmitter {
    constructor() {}
    connect() { queueMicrotask(() => this.emit('error', new Error('do-not-log-this'))); }
    disconnect() {}
  }
  const failing = createRconTransport({
    mode: 'test', env: { ARK_SECRET: 'do-not-log-this' }, timeoutMs: 1000, RconClass: FailingRcon
  });
  await assert.rejects(
    failing.execute({ type: 'listOnlinePlayers', server }),
    error => !error.message.includes('do-not-log-this') && /test-map/.test(error.message)
  );
});

test('Debian launcher wires SQLite migrations and stops cleanly without external network access in mock mode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketbot-v2-launcher-'));
  const configPath = path.join(root, 'instance.json');
  const config = {
    schemaVersion: 1,
    runtime: { mode: 'mock', environment: 'launcher-test', logLevel: 'error' },
    discord: {
      clientId: '10000000000000001',
      guildId: '10000000000000002',
      tokenSecret: 'DISCORD_TOKEN',
      roles: { staff: null, member: null, fulfillmentModerator: null },
      channels: {
        ticketCategory: null, vault: null, requests: null, playerNames: null,
        pinsDashboard: null, ticketLogs: null, fulfillment: null, fulfillmentLogs: null
      }
    },
    ark: {
      timeoutMs: 1000,
      servers: [{
        id: 'test-map', name: 'Test Map', host: '127.0.0.1', port: 27020,
        passwordSecret: 'ARK_SECRET', enabled: true, testOnly: true,
        operations: ['listOnlinePlayers', 'fulfillApprovedCreature']
      }]
    },
    storage: { databasePath: 'runtime/database.sqlite', backupPath: 'runtime/backups' },
    features: { tickets: false, pins: false, playerNames: false, shop: false, fulfillment: false, dashboards: false }
  };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const logs = [];
  const service = await startV2Service({
    sourceRoot: root,
    configPath,
    catalogPath: path.resolve(__dirname, '../../data/dino-catalog.json'),
    env: {},
    write: line => logs.push(line),
    createDiscordClient: () => ({
      on() {},
      off() {},
      login: async () => { throw new Error('Mock startup must not log in without enabled features.'); },
      destroy: async () => {}
    })
  });

  try {
    assert.equal(service.runtime.schemaVersion, 10);
    assert(fs.existsSync(path.join(root, 'runtime', 'database.sqlite')));
    assert(fs.existsSync(path.join(root, 'runtime', 'backups')));
    assert(logs.some(line => line.includes('"type":"runtime.config"')));
  } finally {
    await service.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
