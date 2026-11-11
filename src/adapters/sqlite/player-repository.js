'use strict';

function createSqlitePlayerRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.all !== 'function') {
    throw new TypeError('database run/all interface is required.');
  }
  const values = r => [r.discordId,r.eosId.toLowerCase(),r.displayName,r.verifiedAt,r.source];
  return Object.freeze({
    async save(r) {
      await database.run(`INSERT INTO trusted_players (discord_id,eos_id,display_name,verified_at,source)
        VALUES (?,?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET eos_id=excluded.eos_id,
        display_name=excluded.display_name,verified_at=excluded.verified_at,source=excluded.source`, values(r));
      return r;
    },
    async insert(r) {
      await database.run(`INSERT INTO trusted_players (discord_id,eos_id,display_name,verified_at,source)
        VALUES (?,?,?,?,?)`, values(r));
      return r;
    },
    async approve(r, request, moderatorId, expiresAt) {
      return database.transaction(async () => {
        if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error('This selection flow is invalid or expired.');
        const updated = await database.run(`UPDATE player_names SET status='VERIFIED',moderator_id=?,
          verified_at=?,updated_at=MAX(?,updated_at+1) WHERE discord_id=? AND player_name=? COLLATE BINARY AND updated_at=?
          AND NOT EXISTS (SELECT 1 FROM trusted_players WHERE discord_id=?)`,
        [moderatorId,r.verifiedAt,r.verifiedAt,r.discordId,request.playerName,request.updatedAt,r.discordId]);
        if (updated.changes !== 1) throw Object.assign(new Error('The request changed. Start Link Player again.'), { code:'REQUEST_CHANGED' });
        const existing = await database.get('SELECT 1 AS linked FROM trusted_players WHERE eos_id=? COLLATE NOCASE', [r.eosId]);
        if (existing) throw Object.assign(new Error('This in-game identity is already linked.'), { code:'IDENTITY_ALREADY_LINKED' });
        await database.run(`INSERT INTO trusted_players (discord_id,eos_id,display_name,verified_at,source)
          VALUES (?,?,?,?,?)`, values(r));
      });
    },
    async unlinkAndReset(discordId, eosId, at, expiresAt) {
      return database.transaction(async () => {
        if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error('This selection flow is invalid or expired.');
        const result = await database.run('DELETE FROM trusted_players WHERE discord_id=? AND eos_id=? COLLATE NOCASE', [discordId,eosId]);
        if (result.changes !== 1) throw Object.assign(new Error('This link has changed.'), { code:'LINK_CHANGED' });
        await database.run(`UPDATE player_names SET status='PENDING',moderator_id=NULL,verified_at=NULL,
          updated_at=MAX(?,updated_at+1) WHERE discord_id=?`, [at,discordId]);
      });
    },
    async remove(discordId, eosId) {
      const result = await database.run('DELETE FROM trusted_players WHERE discord_id=? AND eos_id=?', [discordId,eosId]);
      if (result.changes !== 1) throw new Error('Trusted player link changed before removal.');
    },
    async list() {
      const records = await database.all(`SELECT discord_id AS discordId,eos_id AS eosId,
        display_name AS displayName,verified_at AS verifiedAt,source,1 AS verified
        FROM trusted_players ORDER BY discord_id`);
      return records.map(record => ({ ...record,verified:record.verified === 1 || record.verified === true }));
    }
  });
}
module.exports = { createSqlitePlayerRepository };
