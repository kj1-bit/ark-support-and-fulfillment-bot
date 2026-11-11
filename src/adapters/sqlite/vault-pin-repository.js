'use strict';

const SELECT = `SELECT guild_id AS guildId, user_id AS userId, protected_pin AS protectedPin, source,
  created_at AS createdAt, updated_at AS updatedAt, last_delivered_at AS lastDeliveredAt
  FROM vault_pins WHERE guild_id = ? AND user_id = ?`;

function createSqliteVaultPinRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.get !== 'function'
    || typeof database.all !== 'function') {
    throw new TypeError('database run/get/all interface is required.');
  }
  const get = (guildId, userId) => database.get(SELECT, [guildId, userId]);
  return Object.freeze({
    get,
    async directoryPage(guildId, page, pageSize) {
      const { total } = await database.get('SELECT COUNT(*) AS total FROM vault_pins WHERE guild_id=?', [guildId]);
      const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const results = await database.all(
        `SELECT v.user_id AS userId,p.player_name AS playerName,
          COALESCE(r.display_name,t.display_name) AS linkedPlayerName,
          v.protected_pin AS protectedPin
         FROM vault_pins v LEFT JOIN player_names p ON p.discord_id=v.user_id
         LEFT JOIN trusted_players t ON t.discord_id=v.user_id
         LEFT JOIN remembered_players r ON r.eos_id=t.eos_id COLLATE NOCASE
         WHERE v.guild_id=? ORDER BY v.user_id LIMIT ? OFFSET ?`,
        [guildId, pageSize, (currentPage - 1) * pageSize]
      );
      return { page: currentPage, pageSize, total, results };
    },
    async insertIfAbsent(record) {
      const result = await database.run(
        `INSERT INTO vault_pins (guild_id, user_id, protected_pin, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO NOTHING`,
        [record.guildId, record.userId, record.protectedPin, record.source, record.createdAt, record.updatedAt]
      );
      return Object.freeze({ created: result.changes === 1, record: await get(record.guildId, record.userId) });
    },
    async listUserIds(guildId) {
      const rows = await database.all('SELECT user_id AS userId FROM vault_pins WHERE guild_id = ?', [guildId]);
      return rows.map(row => row.userId);
    },
    async markDelivered(guildId, userId, at) {
      const result = await database.run(
        'UPDATE vault_pins SET last_delivered_at = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
        [at, at, guildId, userId]
      );
      return result.changes === 1;
    }
  });
}

module.exports = { createSqliteVaultPinRepository };
