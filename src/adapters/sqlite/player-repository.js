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
