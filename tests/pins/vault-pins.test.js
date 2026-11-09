'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteVaultPinRepository } = require('../../src/adapters/sqlite/vault-pin-repository');
const { createSqlitePinRepository } = require('../../src/adapters/sqlite/pin-repository');
const { createPinProtector } = require('../../src/security/pin-protector');
const { createPinService } = require('../../src/domain/pins/pin-service');
const {
  VaultPinError, createVaultPinService, generateVaultPin, isWeakPin
} = require('../../src/domain/pins/vault-pin-service');
const migration013 = require('../../src/migrations/013-vault-pins');

const GUILD = '10000000000000001';
const VAULT = '10000000000000002';
const DASHBOARD = '10000000000000003';
const MEMBER_ROLE = '10000000000000004';
const STAFF_ROLE = '10000000000000005';
const USER = '10000000000000006';
const STAFF = '10000000000000007';
const OTHER = '10000000000000008';

const migrations = [
  require('../../src/migrations/001-v2-core'),
  require('../../src/migrations/002-trusted-state'),
  require('../../src/migrations/003-player-names'),
  require('../../src/migrations/004-tickets'),
  require('../../src/migrations/005-pins'),
  require('../../src/migrations/006-operational-events'),
  require('../../src/migrations/007-fulfillment-targets'),
  require('../../src/migrations/008-trusted-identity-associations'),
  require('../../src/migrations/009-discord-panels'),
  require('../../src/migrations/010-fulfillment-result-redaction'),
  require('../../src/migrations/011-schema-integrity'),
  migration013
];

async function migratedDatabase() {
  const database = await openSqliteDatabase(':memory:');
  await createMigrationRunner({ database, migrations, clock: () => 0 }).run();
  return database;
}

function memoryRepository() {
  const rows = new Map();
  const key = (g, u) => `${g}:${u}`;
  return {
    rows,
    get: async (g, u) => rows.get(key(g, u)),
    insertIfAbsent: async record => {
      if (rows.has(key(record.guildId, record.userId))) return { created: false, record: rows.get(key(record.guildId, record.userId)) };
      rows.set(key(record.guildId, record.userId), { ...record });
      return { created: true, record: rows.get(key(record.guildId, record.userId)) };
    },
    listUserIds: async g => [...rows.values()].filter(row => row.guildId === g).map(row => row.userId),
    markDelivered: async (g, u, at) => { rows.get(key(g, u)).lastDeliveredAt = at; return true; }
  };
}

function makeVault(overrides = {}) {
  let now = 1000;
  const audits = [];
  const repository = overrides.repository || memoryRepository();
  const sequence = overrides.sequence ? [...overrides.sequence] : null;
  const verified = overrides.verified || new Set([USER, OTHER, STAFF]);
  const service = createVaultPinService({
    repository,
    playerNames: { get: async id => (verified.has(id) ? { status: 'VERIFIED', playerName: 'P' } : { status: 'PENDING' }) },
    protector: { protect: async pin => `sealed:${pin}`, reveal: async value => value.slice(7) },
    authorization: overrides.authorization || {
      authorize(capability, context) {
        if (capability !== 'pins.moderate' || context.guildId !== GUILD || !context.roleIds.includes(STAFF_ROLE)) {
          throw new Error('This operation is not authorized.');
        }
      }
    },
    audit: { write: (type, data) => audits.push([type, data]) },
    guildId: GUILD,
    vaultChannelId: VAULT,
    dashboardChannelId: DASHBOARD,
    eligibleRoleIds: [MEMBER_ROLE, STAFF_ROLE],
    clock: () => now,
    random: sequence ? () => sequence.shift() : undefined,
    ...overrides.options
  });
  return { service, repository, audits, verified, advance: ms => { now += ms; } };
}

const memberContext = (overrides = {}) => ({
  actorId: USER, guildId: GUILD, channelId: VAULT, messageId: '1', roleIds: [MEMBER_ROLE], ...overrides
});
const staffContext = (overrides = {}) => ({
  actorId: STAFF, guildId: GUILD, channelId: DASHBOARD, messageId: '1', roleIds: [STAFF_ROLE], ...overrides
});

test('generated Vault PINs are four digits and reject trivially weak values', () => {
  assert.equal(generateVaultPin(() => 42), '0042');
  for (const weak of ['0000', '7777', '1234', '6789', '9876', '3210']) assert.equal(isWeakPin(weak), true);
  const values = [1111, 1234, 4321, 5820];
  assert.equal(generateVaultPin(() => values.shift()), '5820');
  assert.throws(() => generateVaultPin(() => 1111), error => error instanceof VaultPinError && error.code === 'GENERATION_FAILED');
  for (let i = 0; i < 200; i += 1) assert.match(generateVaultPin(), /^\d{4}$/);
});

test('self-service creates one protected PIN per guild member and redelivers the same PIN only by DM', async () => {
  const { service, repository, audits, advance } = makeVault({ sequence: [5820, 1111] });
  const sent = [];
  const first = await service.deliverOwn({ context: memberContext(), deliver: async pin => { sent.push(pin); return true; } });
  assert.deepEqual(first, { created: true, delivered: true, metadataRecorded: true });
  const stored = repository.rows.get(`${GUILD}:${USER}`);
  assert.equal(stored.protectedPin, 'sealed:5820');
  assert.equal(stored.source, 'SELF_SERVICE');
  advance(30000);
  const second = await service.deliverOwn({ context: memberContext(), deliver: async pin => { sent.push(pin); return true; } });
  assert.equal(second.created, false);
  assert.deepEqual(sent, ['5820', '5820']);
  assert(!JSON.stringify(audits).includes('5820'));
  assert(!JSON.stringify(first).includes('5820'));
  assert.deepEqual(audits.map(([type]) => type), ['pin.vault-generated', 'pin.vault-delivered', 'pin.vault-delivered']);
});

test('self-service enforces guild, vault channel, and member role', async () => {
  const { service, repository } = makeVault();
  const deliver = async () => true;
  for (const context of [
    memberContext({ guildId: '10000000000000099' }),
    memberContext({ channelId: DASHBOARD }),
    memberContext({ roleIds: [] }),
    memberContext({ actorId: 'not-a-snowflake' })
  ]) {
    await assert.rejects(() => service.deliverOwn({ context, deliver }), error => error.code === 'NOT_AUTHORIZED');
  }
  assert.equal(repository.rows.size, 0);
  await service.deliverOwn({ context: memberContext({ roleIds: [STAFF_ROLE] }), deliver });
  assert.equal(repository.rows.size, 1);
});

test('players receive only their own Vault PIN even if they supply another player as a target', async () => {
  const { service, advance } = makeVault({ sequence:[5820,6942] });
  const own = [];
  const other = [];
  await service.deliverOwn({ context:memberContext(),userId:OTHER,
    deliver:async pin => { own.push(pin); return true; } });
  await service.deliverOwn({ context:memberContext({ actorId:OTHER }),userId:USER,
    deliver:async pin => { other.push(pin); return true; } });
  advance(30000);
  await service.deliverOwn({ context:memberContext(),userId:OTHER,
    deliver:async pin => { own.push(pin); return true; } });
  assert.deepEqual(own,['5820','5820']);
  assert.deepEqual(other,['6942']);
});

test('DM failures, cooldown, and concurrent clicks produce explicit errors without exposing the PIN', async () => {
  const { service, audits, advance } = makeVault({ sequence: [5820] });
  await assert.rejects(
    () => service.deliverOwn({ context: memberContext(), deliver: async () => { throw new Error('Cannot send messages to this user 5820'); } }),
    error => error.code === 'DM_FAILED' && /direct message/.test(error.publicMessage) && !error.message.includes('5820')
  );
  let release;
  const slow = service.deliverOwn({ context: memberContext(), deliver: () => new Promise(resolve => { release = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => service.deliverOwn({ context: memberContext(), deliver: async () => true }), error => error.code === 'IN_PROGRESS');
  release(true);
  await slow;
  await assert.rejects(() => service.deliverOwn({ context: memberContext(), deliver: async () => true }), error => error.code === 'COOLDOWN');
  advance(30000);
  await service.deliverOwn({ context: memberContext(), deliver: async () => true });
  assert(!JSON.stringify(audits).includes('5820'));
});

test('unverified player names cannot retrieve Vault PINs and are skipped by bulk generation', async () => {
  const { service, repository, verified } = makeVault({ verified: new Set([STAFF]) });
  let sent = false;
  await assert.rejects(
    () => service.deliverOwn({ context: memberContext(), deliver: async () => { sent = true; return true; } }),
    error => error.code === 'NAME_NOT_VERIFIED' && /verified player name/.test(error.publicMessage)
  );
  assert.equal(sent, false);
  assert.equal(repository.rows.size, 0);
  const summary = await service.generateMissing({ context: staffContext(), memberIds: [USER, OTHER, STAFF] });
  assert.deepEqual(summary, { eligible: 3, created: 1, existing: 0, unverified: 2, failed: 0 });
  assert.deepEqual([...repository.rows.values()].map(row => row.userId), [STAFF]);
  verified.add(USER);
  await service.deliverOwn({ context: memberContext(), deliver: async () => { sent = true; return true; } });
  assert.equal(sent, true);
});

test('staff bulk generation creates only missing PINs, sends nothing, and is bounded', async () => {
  const { service, repository, audits } = makeVault({ sequence: [5820, 4711, 9052], options: { maxBulkMembers: 3 } });
  await service.deliverOwn({ context: memberContext(), deliver: async () => true });
  await assert.rejects(() => service.generateMissing({ context: memberContext(), memberIds: [OTHER] }), /not authorized/);
  await assert.rejects(
    () => service.generateMissing({ context: staffContext({ channelId: VAULT }), memberIds: [OTHER] }),
    error => error.code === 'NOT_AUTHORIZED'
  );
  const summary = await service.generateMissing({
    context: staffContext(),
    memberIds: [USER, OTHER, OTHER, STAFF, 'bad-id']
  });
  assert.deepEqual(summary, { eligible: 3, created: 2, existing: 1, unverified: 0, failed: 0 });
  assert.equal(repository.rows.get(`${GUILD}:${OTHER}`).source, 'STAFF_BULK');
  assert.equal(repository.rows.get(`${GUILD}:${OTHER}`).lastDeliveredAt, undefined);
  await assert.rejects(
    () => service.generateMissing({ context: staffContext(), memberIds: ['10000000000000011', '10000000000000012', '10000000000000013', '10000000000000014'] }),
    error => error.code === 'TOO_MANY_MEMBERS'
  );
  const bulkAudit = audits.find(([type]) => type === 'pin.vault-bulk-generated');
  assert.equal(bulkAudit[1].created, 2);
  assert(!/4711|9052/.test(JSON.stringify(audits)));
});

test('bulk generation counts persistence failures so staff can retry', async () => {
  const repository = memoryRepository();
  const insert = repository.insertIfAbsent;
  let calls = 0;
  repository.insertIfAbsent = async record => { calls += 1; if (calls === 1) throw new Error('SQLITE_BUSY'); return insert(record); };
  const { service } = makeVault({ repository });
  assert.deepEqual(await service.generateMissing({ context: staffContext(), memberIds: [USER, OTHER] }), { eligible: 2, created: 1, existing: 0, unverified: 0, failed: 1 });
  assert.deepEqual(await service.generateMissing({ context: staffContext(), memberIds: [USER, OTHER] }), { eligible: 2, created: 1, existing: 1, unverified: 0, failed: 0 });
});

test('migration 013 is additive and SQLite vault PINs persist encrypted per guild and user', async () => {
  const sql = migration013.statements.join('\n');
  assert.doesNotMatch(sql, /DROP|ALTER|plaintext/i);
  assert.match(sql, /PRIMARY KEY \(guild_id, user_id\)/);
  const database = await migratedDatabase();
  try {
    const protector = createPinProtector({ key: Buffer.alloc(32, 9).toString('base64') });
    const repository = createSqliteVaultPinRepository(database);
    const service = createVaultPinService({
      repository, playerNames: { get: async () => ({ status: 'VERIFIED' }) }, protector, authorization: { authorize() {} }, audit: { write() {} },
      guildId: GUILD, vaultChannelId: VAULT, eligibleRoleIds: [MEMBER_ROLE], random: () => 5820
    });
    let delivered;
    await service.deliverOwn({ context: memberContext(), deliver: async pin => { delivered = pin; return true; } });
    assert.equal(delivered, '5820');
    const row = await database.get('SELECT protected_pin AS protectedPin, last_delivered_at AS lastDeliveredAt FROM vault_pins WHERE guild_id=? AND user_id=?', [GUILD, USER]);
    assert(!row.protectedPin.includes('5820'));
    assert.equal(await protector.reveal(row.protectedPin), '5820');
    assert.notEqual(row.lastDeliveredAt, null);
    const duplicate = await repository.insertIfAbsent({ guildId: GUILD, userId: USER, protectedPin: 'other', source: 'STAFF_BULK', createdAt: 1, updatedAt: 1 });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.record.protectedPin, row.protectedPin);
    const otherGuild = await repository.insertIfAbsent({ guildId: '10000000000000099', userId: USER, protectedPin: 'x', source: 'STAFF_BULK', createdAt: 1, updatedAt: 1 });
    assert.equal(otherGuild.created, true);
    assert.deepEqual(await repository.listUserIds(GUILD), [USER]);
  } finally {
    await database.close();
  }
});

test('PIN moderation buttons are bound to the persisted moderation message', async () => {
  const database = await migratedDatabase();
  try {
    const repository = createSqlitePinRepository(database);
    const service = createPinService({
      repository,
      playerNames: { get: async () => ({ status: 'VERIFIED', playerName: 'Survivor' }) },
      authorization: { authorize() {} },
      protector: { protect: async pin => `sealed:${pin}`, reveal: async value => value.slice(7) },
      audit: { write() {} },
      clock: () => 10,
      uuid: () => '00000000-0000-4000-8000-000000000001'
    });
    const request = await service.request({ pin: '0123', context: { actorId: USER, guildId: GUILD, channelId: VAULT } });
    const buttonContext = messageId => ({ actorId: STAFF, guildId: GUILD, channelId: DASHBOARD, messageId, roleIds: [STAFF_ROLE] });
    await assert.rejects(
      () => service.approve({ requestId: request.id, requireBoundMessage: true, context: buttonContext('20000000000000001') }),
      /mismatched/
    );
    await service.attachModerationMessage({ requestId: request.id, channelId: DASHBOARD, messageId: '20000000000000001' });
    await assert.rejects(() => service.attachModerationMessage({ requestId: request.id, channelId: DASHBOARD, messageId: '20000000000000002' }), /already attached/);
    await assert.rejects(
      () => service.approve({ requestId: request.id, requireBoundMessage: true, context: buttonContext('20000000000000002') }),
      /mismatched/
    );
    const approved = await service.approve({ requestId: request.id, requireBoundMessage: true, context: buttonContext('20000000000000001') });
    assert.equal(approved.state, 'APPROVED');
    let sent;
    const delivered = await service.deliver({
      requestId: request.id,
      requireBoundMessage: true,
      context: buttonContext('20000000000000001'),
      deliver: async pin => { sent = pin; return true; }
    });
    assert.equal(sent, '0123');
    assert.equal(delivered.state, 'DELIVERED');
    assert.equal(delivered.protectedPin, null);
  } finally {
    await database.close();
  }
});
test('protector and persistence failures surface explicit safe errors without PIN material', async () => {
  const repository = memoryRepository();
  const failing = createVaultPinService({
    repository,
    playerNames: { get: async () => ({ status: 'VERIFIED' }) },
    protector: { protect: async pin => { throw new Error(`key unavailable for ${pin}`); }, reveal: async () => '' },
    authorization: { authorize() {} }, audit: { write() {} },
    guildId: GUILD, vaultChannelId: VAULT, eligibleRoleIds: [MEMBER_ROLE], random: () => 5820
  });
  await assert.rejects(() => failing.deliverOwn({ context: memberContext(), deliver: async () => true }),
    error => error.code === 'PROTECTION_FAILED' && !String(error.message).includes('5820'));
  assert.deepEqual(await failing.generateMissing({ context: staffContext(), memberIds: [USER] }),
    { eligible: 1, created: 0, existing: 0, unverified: 0, failed: 1 });
  assert.equal(repository.rows.size, 0);
  repository.insertIfAbsent = async () => { throw new Error('SQLITE_FULL sealed:5820'); };
  const { service } = makeVault({ repository, sequence: [5820] });
  await assert.rejects(() => service.deliverOwn({ context: memberContext(), deliver: async () => true }),
    error => error.code === 'PERSISTENCE_FAILED' && !String(error.message).includes('5820'));
  repository.rows.set(`${GUILD}:${USER}`, { guildId: GUILD, userId: USER, protectedPin: 'corrupt' });
  const corrupt = makeVault({ repository }).service;
  await assert.rejects(() => corrupt.deliverOwn({ context: memberContext(), deliver: async () => true }), error => error.code === 'UNREADABLE');
});

test('SQLite moderation bindings survive restart and rebinding is compare-and-swap', async () => {
  const database = await migratedDatabase();
  try {
    let now = 10;
    let seq = 0;
    const make = () => createPinService({
      repository: createSqlitePinRepository(database),
      playerNames: { get: async () => ({ status: 'VERIFIED', playerName: 'Survivor' }) },
      authorization: { authorize() {} },
      protector: { protect: async pin => `sealed:${pin}`, reveal: async value => value.slice(7) },
      audit: { write() {} }, clock: () => now, uuid: () => `00000000-0000-4000-8000-00000000000${++seq}`, ttlMs: 100
    });
    const before = make();
    const bound = await before.request({ pin: '0123', context: { actorId: USER, guildId: GUILD, channelId: VAULT } });
    const unbound = await before.request({ pin: '4567', context: { actorId: OTHER, guildId: GUILD, channelId: VAULT } });
    await before.attachModerationMessage({ requestId: bound.id, channelId: DASHBOARD, messageId: '20000000000000001' });
    const after = make();
    const open = await after.outstandingModeration({ guildId: GUILD });
    assert.deepEqual(open.map(item => [item.id, item.moderation?.messageId || null]), [[bound.id, '20000000000000001'], [unbound.id, null]]);
    assert(!JSON.stringify(open).includes('sealed'));
    assert.deepEqual(await after.outstandingModeration({ guildId: '10000000000000099' }), []);
    await after.rebindModerationMessage({ requestId: bound.id, channelId: DASHBOARD, previousMessageId: '20000000000000001', messageId: '20000000000000002' });
    await assert.rejects(() => after.rebindModerationMessage({ requestId: bound.id, channelId: DASHBOARD, previousMessageId: '20000000000000001', messageId: '20000000000000003' }), /already attached/);
    const ctx = messageId => ({ actorId: STAFF, guildId: GUILD, channelId: DASHBOARD, messageId, roleIds: [STAFF_ROLE] });
    await assert.rejects(() => after.approve({ requestId: bound.id, requireBoundMessage: true, context: ctx('20000000000000001') }), /mismatched/);
    assert.equal((await after.approve({ requestId: bound.id, requireBoundMessage: true, context: ctx('20000000000000002') })).state, 'APPROVED');
    now = 200;
    assert.deepEqual(await after.outstandingModeration({ guildId: GUILD }), []);
  } finally {
    await database.close();
  }
});

test('Vault PIN delivery metadata failures are audited after a truthful DM success', async () => {
  for (const failure of [async () => { throw new Error('SQLITE_BUSY sealed:5820'); }, async () => false]) {
    const repository = memoryRepository();
    repository.markDelivered = failure;
    const { service, audits } = makeVault({ repository, sequence: [5820] });
    let sent;
    const result = await service.deliverOwn({ context: memberContext(), deliver: async pin => { sent = pin; return true; } });
    assert.equal(sent, '5820');
    assert.deepEqual(result, { created: true, delivered: true, metadataRecorded: false });
    const warning = audits.find(([type]) => type === 'pin.vault-delivery-metadata-failed');
    assert.deepEqual(Object.keys(warning[1]).sort(), ['guildId', 'reason', 'userId']);
    assert(!/5820|SQLITE|sealed/.test(JSON.stringify(audits)));
  }
  const { service, audits } = makeVault({ sequence: [5820] });
  assert.equal((await service.deliverOwn({ context: memberContext(), deliver: async () => true })).metadataRecorded, true);
  assert(!audits.some(([type]) => type === 'pin.vault-delivery-metadata-failed'));
});

test('SQLite open moderation listing pages with a stable cursor across equal timestamps', async () => {
  const database = await migratedDatabase();
  try {
    let seq = 0;
    const service = createPinService({
      repository: createSqlitePinRepository(database),
      playerNames: { get: async () => ({ status: 'VERIFIED', playerName: 'Survivor' }) },
      authorization: { authorize() {} },
      protector: { protect: async pin => `sealed:${pin}`, reveal: async value => value.slice(7) },
      audit: { write() {} }, clock: () => 10, uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, ttlMs: 100
    });
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const actorId = String(10000000000000100n + BigInt(i));
      ids.push((await service.request({ pin: '0123', context: { actorId, guildId: GUILD, channelId: VAULT } })).id);
    }
    const seen = [];
    let after = null;
    let pages = 0;
    for (;;) {
      const batch = await service.outstandingModeration({ guildId: GUILD, limit: 2, after });
      pages += 1;
      seen.push(...batch.map(item => item.id));
      if (batch.length < 2) break;
      after = { createdAt: batch.at(-1).createdAt, id: batch.at(-1).id };
    }
    assert.equal(pages, 3);
    assert.deepEqual(seen, ids);
    assert.equal((await service.moderationRecord(ids[0])).id, ids[0]);
    await service.cancel({ requestId: ids[0], context: { actorId: '10000000000000100' } });
    assert.equal(await service.moderationRecord(ids[0]), null);
  } finally {
    await database.close();
  }
});

test('vault audit events are allowlisted for the pins dashboard and stay secret-safe', async () => {
  const { ALLOWED_TYPES, sanitizeDetails } = require('../../src/domain/dashboards/operational-event-service');
  const repository = memoryRepository();
  repository.markDelivered = async () => false;
  const { service, audits } = makeVault({ repository, sequence: [5820, 4711] });
  await service.deliverOwn({ context: memberContext(), deliver: async () => true });
  await assert.rejects(() => service.deliverOwn({ context: memberContext({ actorId: OTHER }), deliver: async () => false }));
  await service.generateMissing({ context: staffContext(), memberIds: [STAFF] });
  const types = [...new Set(audits.map(([type]) => type))];
  assert.deepEqual(types.sort(), ['pin.vault-bulk-generated', 'pin.vault-delivered', 'pin.vault-delivery-failed', 'pin.vault-delivery-metadata-failed', 'pin.vault-generated']);
  for (const [type, data] of audits) {
    assert(ALLOWED_TYPES.includes(type), type);
    assert.deepEqual(sanitizeDetails(data), data);
  }
  assert(!/5820|4711|sealed/.test(JSON.stringify(audits)));
});
