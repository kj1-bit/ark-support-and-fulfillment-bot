'use strict';

function createSqlitePanelRepository(database) {
  if (!database || typeof database.get !== 'function' || typeof database.run !== 'function') {
    throw new TypeError('database get/run interface is required.');
  }
  return Object.freeze({
    async get(panelKey) {
      return database.get(
        'SELECT panel_key AS panelKey, channel_id AS channelId, message_id AS messageId, updated_at AS updatedAt FROM discord_panel_messages WHERE panel_key = ?',
        [panelKey]
      );
    },
    async save({ panelKey, channelId, messageId, updatedAt }) {
      await database.run(
        `INSERT INTO discord_panel_messages (panel_key, channel_id, message_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(panel_key) DO UPDATE SET
           channel_id = excluded.channel_id,
           message_id = excluded.message_id,
           updated_at = excluded.updated_at`,
        [panelKey, channelId, messageId, updatedAt]
      );
    }
  });
}

module.exports = { createSqlitePanelRepository };
