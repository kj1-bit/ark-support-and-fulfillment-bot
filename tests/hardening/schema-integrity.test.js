'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteFulfillmentRepository } = require('../../src/adapters/sqlite/fulfillment-repository');

const names = [
  'v2-core', 'trusted-state', 'player-names', 'tickets', 'pins', 'operational-events',
  'fulfillment-targets', 'trusted-identity-associations', 'discord-panels',
  'fulfillment-result-redaction', 'schema-integrity'
];
const all = names.map((name, index) => require(`../../src/migrations/${String(index + 1).padStart(3, '0')}-${name}`));

async function migrated(upTo) {
  const database = await openSqliteDatabase(':memory:');
  await createMigrationRunner({ database, migrations: all.slice(0, upTo), clock: () => 0 }).run();
  return database;
}

const fulfillment = (id, state = 'PENDING') => [
  id, `key-${id}`, 'actor', 'guild', 'channel', 'message', 'rex', '2026.1.0', 'map', '0123456789abcdef0123456789abcdef',
  state, 1, 2, 'ref-12345', 'Player'
];
const insertFulfillment = (database, ...row) => database.run(
  `INSERT INTO fulfillment_requests (id, idempotency_key, actor_id, guild_id, channel_id, message_id, creature_id,
     catalog_version, server_id, eos_id, state, created_at, expires_at, player_ref, player_name)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row
);

test('schema 11 constrains critical states, keeps existing rows and indexes, and removes the unused empty table', async () => {
  const database = await migrated(10);
  try {
    await insertFulfillment(database, ...fulfillment('F-1', 'SUCCEEDED'));
    await database.run(
      `INSERT INTO interaction_sessions (token, feature, actor_id, guild_id, channel_id, message_id, action, state, version, created_at, expires_at)
       VALUES ('t', 'fulfillment', 'a', 'g', 'c', 'm', 'x', 'ACTIVE', 1, 1, 2)`
    );
    await database.run(
      `INSERT INTO catalog_versions (version, checksum, catalog_json, state, created_at) VALUES ('2026.1.0', 'c', '{}', 'ACTIVE', 1)`
    );

    await createMigrationRunner({ database, migrations: all, clock: () => 0 }).run();

    assert.equal((await database.get('SELECT state, player_name FROM fulfillment_requests WHERE id = ?', ['F-1'])).state, 'SUCCEEDED');
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM interaction_sessions')).count, 1);
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM catalog_versions')).count, 1);

    const indexes = (await database.all("SELECT name FROM sqlite_master WHERE type='index'")).map(row => row.name);
    for (const name of ['idx_fulfillment_state_expires', 'idx_fulfillment_player_ref', 'idx_sessions_state_expires', 'idx_catalog_active']) {
      assert(indexes.includes(name), `missing index ${name}`);
    }
    const tables = (await database.all("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
    assert(!tables.includes('trusted_identity_associations'));
    assert(!tables.includes('trusted_identity_associations_archive'));
    assert(!tables.some(name => name.endsWith('_rebuild')));

    await assert.rejects(() => insertFulfillment(database, ...fulfillment('F-2', 'BOGUS')), /CHECK constraint/);
    await assert.rejects(() => database.run(
      `INSERT INTO interaction_sessions (token, feature, actor_id, guild_id, channel_id, message_id, action, state, version, created_at, expires_at)
       VALUES ('u', 'f', 'a', 'g', 'c', 'm', 'x', 'BOGUS', 1, 1, 2)`
    ), /CHECK constraint/);
    await assert.rejects(() => database.run(
      `INSERT INTO catalog_versions (version, checksum, catalog_json, state, created_at) VALUES ('2026.2.0', 'c', '{}', 'BOGUS', 1)`
    ), /CHECK constraint/);
    await assert.rejects(() => database.run(
      `INSERT INTO catalog_versions (version, checksum, catalog_json, state, created_at) VALUES ('2026.3.0', 'c', '{}', 'ACTIVE', 1)`
    ), /UNIQUE constraint/);
    await assert.rejects(() => insertFulfillment(database, ...fulfillment('F-3').map((value, index) => index === 1 ? 'key-F-1' : value)), /UNIQUE constraint/);
  } finally {
    await database.close();
  }
});

test('schema 11 archives, rather than drops, a populated unused identity table', async () => {
  const database = await migrated(10);
  try {
    await database.run(
      `INSERT INTO trusted_identity_associations (id, discord_id, normalized_player_name, eos_id, server_id, verification_source, state, observed_at, created_at)
       VALUES ('a', 'd', 'n', 'e', 's', 'manual', 'PENDING', 1, 1)`
    );
    await createMigrationRunner({ database, migrations: all, clock: () => 0 }).run();
    const tables = (await database.all("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
    assert(!tables.includes('trusted_identity_associations'));
    assert.equal((await database.get('SELECT COUNT(*) AS count FROM trusted_identity_associations_archive')).count, 1);
  } finally {
    await database.close();
  }
});

test('schema 11 refuses to run over unsupported states and rolls back without changing data', async () => {
  const database = await migrated(10);
  try {
    await insertFulfillment(database, ...fulfillment('F-1', 'MYSTERY'));
    await assert.rejects(
      () => createMigrationRunner({ database, migrations: all, clock: () => 0 }).run(),
      /fulfillment_requests: 1 record\(s\) have an unsupported state/
    );
    assert.equal((await database.get('SELECT state FROM fulfillment_requests')).state, 'MYSTERY');
    assert.equal((await database.get('SELECT MAX(version) AS version FROM schema_versions')).version, 10);
    const tables = (await database.all("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
    assert(tables.includes('trusted_identity_associations'));
    assert(!tables.some(name => name.endsWith('_rebuild')));
  } finally {
    await database.close();
  }
});

test('migration history must be an exact contiguous prefix with matching names', async () => {
  const history = rows => ({
    executeSql: async () => {},
    run: async () => ({ changes: 1 }),
    all: async sql => (sql.includes('FROM schema_versions') ? rows : [])
  });
  const run = rows => createMigrationRunner({ database: history(rows), migrations: all.slice(0, 4), clock: () => 0 }).run();
  const row = (version, name = all[version - 1].name) => ({ version, name });

  await assert.rejects(() => run([row(1), row(3), row(4)]), /history is incomplete/);
  await assert.rejects(() => run([row(2), row(3)]), /history is incomplete/);
  await assert.rejects(() => run([row(1), row(2, 'renamed')]), /history is incomplete/);
  assert.equal(await run([row(1), row(2), row(3), row(4)]), 4);
  assert.equal(await run([row(1), row(2)]), 4);
});

test('malformed persisted fulfillment results degrade safely instead of breaking the request', async () => {
  const database = await migrated(11);
  try {
    const repository = createSqliteFulfillmentRepository(database);
    await insertFulfillment(database, ...fulfillment('F-1', 'EXECUTING'));
    for (const corrupt of ['not json', '{"success":true}', JSON.stringify(Array.from({ length: 21 }, () => ({ success: true })))]) {
      await database.run('UPDATE fulfillment_requests SET result_json = ? WHERE id = ?', [corrupt, 'F-1']);
      const record = await repository.get('F-1');
      assert.equal(record.id, 'F-1');
      assert.equal(record.state, 'EXECUTING');
      assert.equal(record.results, undefined);
      assert.equal(record.resultsCorrupt, true);
    }

    const repaired = await repository.updateResults('F-1', [{ success: true, operationIndex: 1 }]);
    assert.deepEqual(repaired.results, [{ success: true, operationIndex: 1 }]);
    assert.equal(repaired.resultsCorrupt, undefined);
    const final = await repository.update('F-1', 'SUCCEEDED', { completedAt: 3 });
    assert.equal(final.state, 'SUCCEEDED');
  } finally {
    await database.close();
  }
});
