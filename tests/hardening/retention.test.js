'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteRetentionRepository } = require('../../src/adapters/sqlite/retention-repository');
const { createSqlitePinRepository } = require('../../src/adapters/sqlite/pin-repository');
const { createRetentionService } = require('../../src/application/retention-service');
const { resolveRetentionPolicy } = require('../../src/config/retention-policy');
const { validateConfig } = require('../../src/config/validate-config');
const { startV2 } = require('../../src/composition/start-v2');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = 1000 * DAY;
const migrations = [
  '001-v2-core', '002-trusted-state', '003-player-names', '004-tickets', '005-pins',
  '006-operational-events', '007-fulfillment-targets', '008-trusted-identity-associations',
  '009-discord-panels', '010-fulfillment-result-redaction'
].map(name => require(`../../src/migrations/${name}`));

function openDatabase() {
  const connection = new sqlite3.Database(':memory:');
  const database = {
    executeSql: sql => new Promise((resolve, reject) => connection.exec(sql, e => (e ? reject(e) : resolve()))),
    all: (sql, args = []) => new Promise((resolve, reject) => connection.all(sql, args, (e, rows) => (e ? reject(e) : resolve(rows)))),
    get: (sql, args = []) => new Promise((resolve, reject) => connection.get(sql, args, (e, row) => (e ? reject(e) : resolve(row)))),
    run: (sql, args = []) => new Promise((resolve, reject) => connection.run(sql, args, function done(e) {
      if (e) reject(e); else resolve({ changes: this.changes, lastID: this.lastID });
    })),
    close: () => new Promise((resolve, reject) => connection.close(e => (e ? reject(e) : resolve())))
  };
  return database;
}

async function insert(database, table, row) {
  const keys = Object.keys(row);
  await database.run(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map(key => row[key])
  );
}

const fulfillment = (id, state, extra = {}) => ({
  id, idempotency_key: `key-${id}`, actor_id: '10000000000000001', guild_id: '10000000000000002',
  channel_id: '10000000000000003', message_id: '10000000000000004', creature_id: 'rex',
  catalog_version: '1', server_id: 'map', eos_id: 'a'.repeat(32), player_ref: 'player-ref-1',
  player_name: 'Target', state, created_at: NOW - 500 * DAY, expires_at: NOW - 500 * DAY + 1000,
  ...extra
});
const pin = (id, actor, state, extra = {}) => ({
  id, actor_id: actor, player_name: 'P', guild_id: 'g', channel_id: 'c', protected_pin: 'sealed',
  state, created_at: NOW - 100 * DAY, updated_at: NOW - 100 * DAY, expires_at: NOW + HOUR, ...extra
});
const ticket = (id, actor, state, updated) => ({
  id, type: 'support', description: 'd', actor_id: actor, player_name: 'P', guild_id: 'g',
  channel_id: 'c', state, created_at: updated, updated_at: updated
});
const session = (token, expires) => ({
  token, feature: 'f', actor_id: 'a', guild_id: 'g', channel_id: 'c', message_id: 'm', action: 'x',
  state: 'ACTIVE', version: 1, created_at: 0, expires_at: expires
});

async function seeded() {
  const database = openDatabase();
  await createMigrationRunner({ database, migrations, clock: () => NOW }).run();
  for (const row of [
    session('old', NOW - 2 * DAY), session('recent-expired', NOW - HOUR), session('live', NOW + HOUR)
  ]) await insert(database, 'interaction_sessions', row);
  for (const row of [
    ticket('T-old-closed', 'u1', 'CLOSED', NOW - 400 * DAY),
    ticket('T-new-closed', 'u2', 'CLOSED', NOW - 10 * DAY),
    ticket('T-old-open', 'u3', 'OPEN', NOW - 400 * DAY)
  ]) await insert(database, 'tickets', row);
  for (const row of [
    pin('P-expired', 'u1', 'PENDING', { expires_at: NOW - 1 }),
    pin('P-live', 'u2', 'APPROVED'),
    pin('P-old-delivered', 'u3', 'DELIVERED', { protected_pin: null, updated_at: NOW - 40 * DAY }),
    pin('P-recent-canceled', 'u4', 'CANCELED', { updated_at: NOW - DAY })
  ]) await insert(database, 'pin_requests', row);
  for (const [type, at] of [['ticket.created', NOW - 91 * DAY], ['ticket.closed', NOW - DAY]]) {
    await insert(database, 'operational_events', { type, category: 'tickets', occurred_at: at, details_json: '{}' });
  }
  for (const row of [
    fulfillment('F-pending', 'PENDING', { created_at: NOW - HOUR, expires_at: NOW - 1 }),
    fulfillment('F-claimed', 'CLAIMED', { created_at: NOW - HOUR, expires_at: NOW + HOUR }),
    fulfillment('F-executing', 'EXECUTING', {
      created_at: NOW - HOUR, expires_at: NOW + HOUR, result_json: '[{"success":true,"operationIndex":1}]'
    }),
    fulfillment('F-anonymize', 'SUCCEEDED', { completed_at: NOW - 100 * DAY }),
    fulfillment('F-purge', 'SUCCEEDED', { completed_at: NOW - 400 * DAY }),
    fulfillment('F-recent', 'SUCCEEDED', { completed_at: NOW - DAY })
  ]) await insert(database, 'fulfillment_requests', row);
  return database;
}

const ids = async (database, table, column = 'id') =>
  (await database.all(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`)).map(row => row.id);

test('retention policy has bounded defaults and rejects unsafe overrides', () => {
  assert.equal(resolveRetentionPolicy().completedPinDays, 30);
  assert.throws(() => resolveRetentionPolicy({ closedTicketDays: 0 }), /closedTicketDays/);
  assert.throws(() => resolveRetentionPolicy({ unknown: 1 }), /unknown retention setting/);
  assert.throws(
    () => resolveRetentionPolicy({ fulfillmentIdentityDays: 400, fulfillmentAuditDays: 30 }),
    /cannot exceed/
  );
});

test('configuration accepts a valid retention section and rejects invalid ones', () => {
  const base = JSON.parse(require('node:fs').readFileSync('config/examples/instance.example.json', 'utf8'));
  const issuesOf = value => { try { validateConfig(value); } catch (error) { return error.issues; } return []; };
  assert.deepEqual(issuesOf({ ...base, retention: { completedPinDays: 7 } }), []);
  assert.match(issuesOf({ ...base, retention: { completedPinDays: 99999 } }).join(), /retention\.completedPinDays/);
  assert.match(issuesOf({ ...base, retention: { sessions: 1 } }).join(), /unknown retention setting/);
});

test('enabled PINs require their protection key before the database is opened outside mock mode', () => {
  const base = JSON.parse(require('node:fs').readFileSync('config/examples/instance.example.json', 'utf8'));
  const config = { ...base, runtime: { ...base.runtime, mode: 'test' } };
  const secrets = { DISCORD_TOKEN: 'x', ARK_TEST_RCON_PASSWORD: 'y' };
  const issuesOf = env => { try { validateConfig(config, { env }); } catch (error) { return error.issues.join(); } return ''; };
  assert.match(issuesOf(secrets), /PIN_PROTECTION_KEY/);
  assert.equal(issuesOf({ ...secrets, PIN_PROTECTION_KEY: 'z' }), '');
});

test('retention applies every policy against real SQLite state and keeps live records', async () => {
  const database = await seeded();
  try {
    const events = [];
    const service = createRetentionService({
      repository: createSqliteRetentionRepository(database),
      audit: { write: (type, data) => events.push([type, data]) },
      clock: () => NOW
    });

    const recovered = await service.recoverInterrupted();
    assert.deepEqual({ ...recovered }, { failed: 1, uncertain: 1 });

    const summary = await service.runOnce();
    assert.deepEqual([...summary.failures], []);
    assert.equal(summary.accessCodesExpired, 1);
    assert.equal(summary.accessCodesCleared, 1);
    assert.equal(summary.accessCodesPurged, 1);
    assert.equal(summary.sessionsPurged, 1);
    assert.equal(summary.ticketsPurged, 1);
    assert.equal(summary.eventsPurged, 1);
    assert.equal(summary.fulfillmentExpired, 1);
    assert.equal(summary.fulfillmentPurged, 1);

    assert.deepEqual(await ids(database, 'interaction_sessions', 'token'), ['live', 'recent-expired']);
    assert.deepEqual(await ids(database, 'tickets'), ['T-new-closed', 'T-old-open']);
    assert.deepEqual(await ids(database, 'pin_requests'), ['P-expired', 'P-live', 'P-recent-canceled']);
    assert.equal((await database.get("SELECT state, protected_pin FROM pin_requests WHERE id='P-expired'")).state, 'EXPIRED');
    assert.equal((await database.get("SELECT protected_pin FROM pin_requests WHERE id='P-expired'")).protected_pin, null);
    assert.equal((await database.get("SELECT protected_pin FROM pin_requests WHERE id='P-recent-canceled'")).protected_pin, null);
    assert.equal((await database.get("SELECT protected_pin FROM pin_requests WHERE id='P-live'")).protected_pin, 'sealed');
    assert.deepEqual(await ids(database, 'operational_events', 'type'), ['ticket.closed']);

    const states = Object.fromEntries((await database.all('SELECT id, state, eos_id, player_ref, player_name, result_json FROM fulfillment_requests'))
      .map(row => [row.id, row]));
    assert.equal(states['F-pending'].state, 'EXPIRED');
    assert.equal(states['F-claimed'].state, 'FAILED');
    assert.equal(states['F-executing'].state, 'UNCERTAIN');
    assert.equal(states['F-executing'].result_json, '[{"success":true,"operationIndex":1}]');
    assert.equal(states['F-purge'], undefined);
    assert.equal(states['F-anonymize'].eos_id, 'REDACTED');
    assert.equal(states['F-anonymize'].player_ref, 'REDACTED');
    assert.equal(states['F-anonymize'].player_name, 'REDACTED');
    assert.equal(states['F-recent'].eos_id, 'a'.repeat(32));
    assert.equal(events.at(-1)[0], 'retention.completed');
    assert(!JSON.stringify(events).includes('a'.repeat(32)));

    const second = await service.runOnce();
    assert.equal(second.accessCodesPurged + second.sessionsPurged + second.ticketsPurged + second.eventsPurged, 0);
  } finally {
    await database.close();
  }
});

test('an expired active PIN request no longer blocks the player from requesting again', async () => {
  const database = openDatabase();
  try {
    await createMigrationRunner({ database, migrations, clock: () => NOW }).run();
    const repository = createSqlitePinRepository(database);
    await insert(database, 'pin_requests', pin('P-old', 'u1', 'PENDING', { expires_at: NOW - 1 }));
    await assert.rejects(() => repository.create({
      id: 'P-new', actorId: 'u1', playerName: 'P', guildId: 'g', channelId: 'c', protectedPin: 'sealed',
      state: 'PENDING', createdAt: NOW, updatedAt: NOW, expiresAt: NOW + HOUR
    }), /active PIN request/);
    assert.equal(await repository.expireStale('u1', NOW), 1);
    const created = await repository.create({
      id: 'P-new', actorId: 'u1', playerName: 'P', guildId: 'g', channelId: 'c', protectedPin: 'sealed',
      state: 'PENDING', createdAt: NOW, updatedAt: NOW, expiresAt: NOW + HOUR
    });
    assert.equal(created.state, 'PENDING');
    assert.equal((await repository.get('P-old')).protectedPin, null);
  } finally {
    await database.close();
  }
});

test('one failing retention step does not stop the others and is reported without details', async () => {
  const calls = [];
  const count = name => async () => { calls.push(name); return 0; };
  const repository = Object.fromEntries([
    'expirePinRequests', 'clearTerminalPinMaterial', 'purgePinRequests', 'purgeSessions',
    'purgeClosedTickets', 'purgeOperationalEvents', 'expireFulfillmentRequests',
    'recoverInterruptedFulfillment', 'anonymizeFulfillmentIdentity', 'purgeFulfillmentRequests'
  ].map(name => [name, count(name)]));
  repository.purgeSessions = async () => { throw new Error('SQLITE_BUSY: secret path'); };
  const events = [];
  const service = createRetentionService({ repository, audit: { write: (...e) => events.push(e) }, clock: () => NOW });
  const summary = await service.runOnce();
  assert.deepEqual([...summary.failures], ['sessionsPurged']);
  assert(calls.includes('purgeFulfillmentRequests'));
  assert.equal(events[0][0], 'retention.failed');
  assert(!JSON.stringify(events).includes('secret path'));
});

test('retention scheduler is unref-ed, does not overlap runs, and stops cleanly', async () => {
  let release;
  let runs = 0;
  const repository = Object.fromEntries([
    'expirePinRequests', 'clearTerminalPinMaterial', 'purgePinRequests', 'purgeClosedTickets',
    'purgeOperationalEvents', 'expireFulfillmentRequests', 'recoverInterruptedFulfillment',
    'anonymizeFulfillmentIdentity', 'purgeFulfillmentRequests'
  ].map(name => [name, async () => 0]));
  repository.purgeSessions = () => { runs += 1; return new Promise(resolve => { release = () => resolve(0); }); };
  let tick;
  let cleared = false;
  const timer = { unref() { this.unrefd = true; } };
  const service = createRetentionService({
    repository,
    audit: { write() {} },
    clock: () => NOW,
    setIntervalFn: callback => { tick = callback; return timer; },
    clearIntervalFn: handle => { cleared = handle === timer; }
  });
  service.start();
  service.start();
  assert.equal(timer.unrefd, true);
  tick();
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runs, 1);
  const stopping = service.stop();
  release();
  await stopping;
  assert.equal(cleared, true);
});

test('startV2 recovers interrupted fulfillment before Discord starts and stops retention on shutdown', async () => {
  const order = [];
  const retention = {
    recoverInterrupted: async () => order.push('recover'),
    start: () => order.push('retention-start'),
    runOnce: async () => order.push('initial-run'),
    stop: async () => order.push('retention-stop')
  };
  const database = { close: async () => order.push('db-close') };
  const started = await startV2({
    configPath: 'config/examples/instance.example.json',
    env: {},
    sourceRoot: process.cwd(),
    openDatabase: async () => database,
    composeRuntime: async () => ({ retention }),
    createDiscordAdapter: async () => ({ start: async () => order.push('discord-start'), stop: async () => order.push('discord-stop') })
  });
  assert.deepEqual(order.slice(0, 2), ['recover', 'discord-start']);
  await started.stop();
  await started.stop();
  assert.deepEqual(order.filter(item => item.endsWith('stop') || item === 'db-close'), ['retention-stop', 'discord-stop', 'db-close']);
});
