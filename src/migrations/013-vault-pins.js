'use strict';

module.exports = Object.freeze({
  version: 13,
  name: 'vault-pins',
  statements: Object.freeze([
    `CREATE TABLE IF NOT EXISTS vault_pins (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      protected_pin TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('SELF_SERVICE', 'STAFF_BULK')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_delivered_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS pin_request_messages (
      request_id TEXT PRIMARY KEY REFERENCES pin_requests(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )`
  ])
});
