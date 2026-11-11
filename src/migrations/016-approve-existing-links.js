'use strict';

module.exports = Object.freeze({
  version: 16,
  name: 'approve-existing-links',
  statements: Object.freeze([
    `CREATE TABLE player_names_v16 (
      discord_id TEXT PRIMARY KEY, player_name TEXT NOT NULL COLLATE NOCASE,
      status TEXT NOT NULL CHECK(status IN ('PENDING','VERIFIED')), moderator_id TEXT,
      verified_at INTEGER, updated_at INTEGER NOT NULL
    )`,
    `INSERT INTO player_names_v16 (discord_id,player_name,status,moderator_id,verified_at,updated_at)
      SELECT discord_id,player_name,status,moderator_id,verified_at,updated_at FROM player_names`,
    'DROP TABLE player_names',
    'ALTER TABLE player_names_v16 RENAME TO player_names',
    'CREATE INDEX idx_player_names_status ON player_names(status)',
    `INSERT INTO player_names (discord_id,player_name,status,moderator_id,verified_at,updated_at)
      SELECT t.discord_id,t.display_name,'VERIFIED',NULL,t.verified_at,t.verified_at
      FROM trusted_players t WHERE NOT EXISTS
        (SELECT 1 FROM player_names p WHERE p.discord_id=t.discord_id)`,
    `UPDATE player_names SET status='VERIFIED',
      verified_at=COALESCE(verified_at, (SELECT verified_at FROM trusted_players
        WHERE trusted_players.discord_id=player_names.discord_id))
      WHERE status='PENDING' AND EXISTS
        (SELECT 1 FROM trusted_players WHERE trusted_players.discord_id=player_names.discord_id)`
  ])
});
