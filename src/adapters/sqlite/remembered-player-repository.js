'use strict';

function createRememberedPlayerRepository(database) {
  return Object.freeze({
    async remember({ eosId, displayName, serverId, lastSeenAt }) {
      await database.run(`INSERT INTO remembered_players (eos_id, display_name, server_id, last_seen_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(eos_id) DO UPDATE SET
        display_name=excluded.display_name, server_id=excluded.server_id, last_seen_at=excluded.last_seen_at
        WHERE excluded.last_seen_at >= remembered_players.last_seen_at`,
      [eosId, displayName, serverId, lastSeenAt]);
    },
    async page(page = 1) {
      const [{ total }] = await database.all('SELECT COUNT(*) AS total FROM remembered_players');
      const current = Math.min(page, Math.max(1, Math.ceil(total / 25)));
      const players = await database.all(`SELECT eos_id AS eosId, display_name AS displayName,
        server_id AS serverId, last_seen_at AS lastSeenAt FROM remembered_players
        ORDER BY last_seen_at DESC, eos_id LIMIT 25 OFFSET ?`, [(current - 1) * 25]);
      return { players, total, page: current, pageSize: 25 };
    },
    async matching(name) {
      const escaped = String(name).replace(/[\\%_]/g, '\\$&');
      return database.all(`SELECT eos_id AS eosId,display_name AS displayName,server_id AS serverId,
        last_seen_at AS lastSeenAt FROM remembered_players
        WHERE display_name LIKE ? ESCAPE '\\'
        ORDER BY CASE WHEN display_name = ? COLLATE NOCASE THEN 0 ELSE 1 END,
          last_seen_at DESC,eos_id LIMIT 25`, [`%${escaped}%`,name]);
    }
  });
}

module.exports = { createRememberedPlayerRepository };
