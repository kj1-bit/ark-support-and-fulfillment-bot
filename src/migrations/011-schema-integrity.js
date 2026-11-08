'use strict';

const REBUILDS = Object.freeze([
  Object.freeze({
    table: 'fulfillment_requests',
    states: Object.freeze(['PENDING', 'CLAIMED', 'EXECUTING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'UNCERTAIN', 'CANCELED', 'EXPIRED']),
    columns: Object.freeze([
      'id', 'idempotency_key', 'actor_id', 'guild_id', 'channel_id', 'message_id', 'creature_id',
      'catalog_version', 'server_id', 'eos_id', 'state', 'created_at', 'expires_at', 'claimed_at',
      'completed_at', 'result_json', 'player_ref', 'player_name'
    ]),
    definition: states => `(
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      actor_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      creature_id TEXT NOT NULL,
      catalog_version TEXT NOT NULL,
      server_id TEXT NOT NULL,
      eos_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (${states})),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      claimed_at INTEGER,
      completed_at INTEGER,
      result_json TEXT,
      player_ref TEXT,
      player_name TEXT
    )`,
    indexes: Object.freeze([
      'CREATE INDEX idx_fulfillment_state_expires ON fulfillment_requests(state, expires_at)',
      'CREATE INDEX idx_fulfillment_player_ref ON fulfillment_requests(player_ref)'
    ])
  }),
  Object.freeze({
    table: 'interaction_sessions',
    states: Object.freeze(['ACTIVE', 'CONSUMED']),
    columns: Object.freeze([
      'token', 'feature', 'actor_id', 'guild_id', 'channel_id', 'message_id', 'action', 'request_id',
      'state', 'version', 'created_at', 'expires_at', 'consumed_at'
    ]),
    definition: states => `(
      token TEXT PRIMARY KEY,
      feature TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      action TEXT NOT NULL,
      request_id TEXT,
      state TEXT NOT NULL CHECK (state IN (${states})),
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    )`,
    indexes: Object.freeze([
      'CREATE INDEX idx_sessions_state_expires ON interaction_sessions(state, expires_at)'
    ])
  }),
  Object.freeze({
    table: 'catalog_versions',
    states: Object.freeze(['ACTIVE', 'RETAINED']),
    columns: Object.freeze(['version', 'checksum', 'catalog_json', 'state', 'created_at', 'activated_at']),
    definition: states => `(
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      catalog_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (${states})),
      created_at INTEGER NOT NULL,
      activated_at INTEGER
    )`,
    indexes: Object.freeze([
      "CREATE UNIQUE INDEX idx_catalog_active ON catalog_versions(state) WHERE state='ACTIVE'"
    ])
  })
]);

const UNUSED_TABLE = 'trusted_identity_associations';
const UNUSED_ARCHIVE = 'trusted_identity_associations_archive';

async function tableExists(database, name) {
  const rows = await database.all("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]);
  return rows.length > 0;
}

async function assertValidStates(database, { table, states }) {
  const list = states.map(state => `'${state}'`).join(',');
  const invalid = await database.all(
    `SELECT COUNT(*) AS count FROM ${table} WHERE state IS NULL OR state NOT IN (${list})`
  );
  if (invalid[0]?.count > 0) {
    throw new Error(`Cannot constrain ${table}: ${invalid[0].count} record(s) have an unsupported state.`);
  }
}

async function rebuild(database, spec) {
  const list = spec.states.map(state => `'${state}'`).join(',');
  const staging = `${spec.table}_rebuild`;
  const columns = spec.columns.join(', ');
  await database.executeSql(`DROP TABLE IF EXISTS ${staging}`);
  await database.executeSql(`CREATE TABLE ${staging} ${spec.definition(list)}`);
  await database.executeSql(`INSERT INTO ${staging} (${columns}) SELECT ${columns} FROM ${spec.table}`);
  await database.executeSql(`DROP TABLE ${spec.table}`);
  await database.executeSql(`ALTER TABLE ${staging} RENAME TO ${spec.table}`);
  for (const statement of spec.indexes) await database.executeSql(statement);
}

module.exports = Object.freeze({
  version: 11,
  name: 'schema-integrity',
  statements: Object.freeze([]),
  async up(database) {
    // Validate every table before changing any of them so an invalid record aborts the whole migration.
    for (const spec of REBUILDS) await assertValidStates(database, spec);
    for (const spec of REBUILDS) await rebuild(database, spec);

    // Migration 008 created an association table that no runtime path reads or writes.
    // Empty tables are dropped; any rows are preserved under an archive name.
    if (await tableExists(database, UNUSED_TABLE)) {
      const rows = await database.all(`SELECT COUNT(*) AS count FROM ${UNUSED_TABLE}`);
      if (rows[0]?.count === 0) {
        await database.executeSql(`DROP TABLE ${UNUSED_TABLE}`);
      } else {
        if (await tableExists(database, UNUSED_ARCHIVE)) {
          throw new Error(`${UNUSED_ARCHIVE} already exists; refusing to overwrite archived data.`);
        }
        await database.executeSql(`ALTER TABLE ${UNUSED_TABLE} RENAME TO ${UNUSED_ARCHIVE}`);
      }
    }
  }
});
