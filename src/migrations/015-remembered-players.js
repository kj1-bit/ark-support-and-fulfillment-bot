'use strict';

module.exports = {
  version: 15,
  name: 'remembered-players',
  statements: [
    `CREATE TABLE remembered_players (
      eos_id TEXT PRIMARY KEY CHECK(length(eos_id) = 32 AND eos_id NOT GLOB '*[^0-9a-f]*'),
      display_name TEXT NOT NULL,
      server_id TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`,
    'CREATE INDEX remembered_players_recent ON remembered_players(last_seen_at DESC, eos_id)',
    `INSERT OR IGNORE INTO remembered_players (eos_id, display_name, server_id, last_seen_at)
      SELECT lower(eos_id), display_name, 'previous-link', verified_at FROM trusted_players
      WHERE length(eos_id) = 32 AND lower(eos_id) NOT GLOB '*[^0-9a-f]*'
      ORDER BY verified_at DESC, discord_id`
  ]
};
