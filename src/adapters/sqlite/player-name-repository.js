'use strict';

function createSqlitePlayerNameRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.get !== 'function') {
    throw new TypeError('database run/get interface is required.');
  }
  const findByDiscord = id => database.get(`SELECT discord_id AS discordId,player_name AS playerName,
    status,moderator_id AS moderatorId,verified_at AS verifiedAt,updated_at AS updatedAt
    FROM player_names WHERE discord_id=?`, [id]);
  return Object.freeze({
    async submit(r) {
      const result = await database.run(`INSERT INTO player_names (discord_id,player_name,status,updated_at)
          SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM trusted_players WHERE discord_id=?)
          ON CONFLICT(discord_id) DO UPDATE SET player_name=excluded.player_name,status='PENDING',
          moderator_id=NULL,verified_at=NULL,updated_at=MAX(excluded.updated_at,player_names.updated_at+1)`,
        [r.discordId,r.playerName,r.status,r.updatedAt,r.discordId]);
      if (result.changes !== 1) {
        throw Object.assign(new Error('You are already linked. Ask staff to unlink you first.'), { code:'NAME_ALREADY_LINKED' });
      }
      return findByDiscord(r.discordId);
    },
    async verify(r) {
      const result = await database.run(`UPDATE player_names SET status='VERIFIED',moderator_id=?,verified_at=?,updated_at=?
        WHERE discord_id=? AND status='PENDING'`, [r.moderatorId,r.verifiedAt,r.verifiedAt,r.discordId]);
      if (result.changes !== 1) throw new Error('Player-name request is missing or no longer pending.');
      return findByDiscord(r.discordId);
    },
    findByDiscord,
    linkedName(id) {
      return database.get(`SELECT COALESCE(r.display_name,t.display_name) AS displayName
        FROM trusted_players t LEFT JOIN remembered_players r ON r.eos_id=t.eos_id COLLATE NOCASE
        WHERE t.discord_id=?`, [id]);
    },
    async queue(page = 1, pageSize = 10) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error('Invalid request page.');
      const { total } = await database.get(`SELECT COUNT(*) AS total FROM player_names p
        WHERE NOT EXISTS (SELECT 1 FROM trusted_players t WHERE t.discord_id=p.discord_id)`);
      const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const results = await database.all(`SELECT p.discord_id AS discordId,p.player_name AS playerName,
        p.status,p.updated_at AS updatedAt FROM player_names p
        WHERE NOT EXISTS (SELECT 1 FROM trusted_players t WHERE t.discord_id=p.discord_id)
        ORDER BY p.updated_at,p.discord_id LIMIT ? OFFSET ?`, [pageSize,(current - 1) * pageSize]);
      return { results, total, page:current, pageSize };
    }
  });
}
module.exports = { createSqlitePlayerNameRepository };
