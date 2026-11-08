'use strict';
module.exports = Object.freeze({
  version: 1,
  name: 'v2-core',
  statements: Object.freeze([
    `CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS fulfillment_requests (
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
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      claimed_at INTEGER,
      completed_at INTEGER,
      result_json TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_fulfillment_state_expires ON fulfillment_requests(state, expires_at)`
  ])
});
