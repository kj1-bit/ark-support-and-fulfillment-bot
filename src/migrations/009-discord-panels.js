'use strict';

module.exports = Object.freeze({
  version: 9,
  name: 'discord-panel-messages',
  statements: Object.freeze([
    `CREATE TABLE IF NOT EXISTS discord_panel_messages (
      panel_key TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ])
});
