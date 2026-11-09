'use strict';

const OPEN_MODERATION_SELECT = `SELECT r.id,r.actor_id AS actorId,r.player_name AS playerName,r.guild_id AS guildId,r.state,
  r.created_at AS createdAt,m.channel_id AS messageChannelId,m.message_id AS messageId
  FROM pin_requests r LEFT JOIN pin_request_messages m ON m.request_id=r.id`;

function createSqlitePinRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.get !== 'function') {
    throw new TypeError('database run/get interface is required.');
  }
  const get = id => database.get('SELECT id,actor_id AS actorId,player_name AS playerName,guild_id AS guildId,channel_id AS channelId,protected_pin AS protectedPin,state,moderator_id AS moderatorId,created_at AS createdAt,updated_at AS updatedAt,expires_at AS expiresAt FROM pin_requests WHERE id=?', [id]);
  return Object.freeze({
    get,
    listRetiredControls({ guildId, channelId, after = '', limit = 100 }) {
      return database.all(
        `SELECT r.id,m.message_id AS messageId,m.channel_id AS channelId
         FROM pin_requests r JOIN pin_request_messages m ON m.request_id=r.id
         WHERE r.guild_id=? AND m.channel_id=? AND r.id>? ORDER BY r.id LIMIT ?`,
        [guildId, channelId, after, Math.max(1, Math.min(100, limit))]
      );
    },
    async expireStale(actorId, now) {
      const result = await database.run(`UPDATE pin_requests SET state='EXPIRED',protected_pin=NULL,updated_at=? WHERE actor_id=? AND state IN ('PENDING','APPROVED') AND expires_at<=?`, [now, actorId, now]);
      return result.changes;
    },
    async create(r) {
      try {
        await database.run(`INSERT INTO pin_requests (id,actor_id,player_name,guild_id,channel_id,protected_pin,state,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [r.id, r.actorId, r.playerName, r.guildId, r.channelId, r.protectedPin, r.state, r.createdAt, r.updatedAt, r.expiresAt]);
      } catch (error) {
        if (/unique/i.test(String(error.message))) throw new Error('An active PIN request already exists.');
        throw error;
      }
      return get(r.id);
    },
    async transition(id, from, to, meta) {
      const placeholders = from.map(() => '?').join(',');
      const protectedSql = meta.clearProtectedPin ? ',protected_pin=NULL' : '';
      const result = await database.run(`UPDATE pin_requests SET state=?,moderator_id=?,updated_at=?${protectedSql} WHERE id=? AND state IN (${placeholders})`, [to, meta.moderatorId, meta.updatedAt, id, ...from]);
      if (result.changes !== 1) throw new Error('PIN request state changed concurrently or transition is invalid.');
      return get(id);
    },
    async attachModerationMessage({ requestId, channelId, messageId, createdAt }) {
      const result = await database.run(
        'INSERT INTO pin_request_messages (request_id,channel_id,message_id,created_at) VALUES (?,?,?,?) ON CONFLICT(request_id) DO NOTHING',
        [requestId, channelId, messageId, createdAt]
      );
      if (result.changes !== 1) throw new Error('PIN moderation message is already attached.');
      return Object.freeze({ requestId, channelId, messageId });
    },
    async listOpenWithModeration({ guildId, now, limit, after = null }) {
      if (typeof database.all !== 'function') return [];
      const afterCreatedAt = after ? Number(after.createdAt) : -1;
      const afterId = after ? String(after.id) : '';
      return database.all(
        `${OPEN_MODERATION_SELECT}
         WHERE r.guild_id=? AND r.state IN ('PENDING','APPROVED') AND r.expires_at>?
           AND (r.created_at>? OR (r.created_at=? AND r.id>?))
         ORDER BY r.created_at,r.id LIMIT ?`,
        [guildId, now, afterCreatedAt, afterCreatedAt, afterId, limit]
      );
    },
    getOpenWithModeration(requestId, now) {
      return database.get(
        `${OPEN_MODERATION_SELECT} WHERE r.id=? AND r.state IN ('PENDING','APPROVED') AND r.expires_at>?`,
        [requestId, now]
      );
    },
    async rebindModerationMessage({ requestId, channelId, previousMessageId, messageId }) {
      const result = await database.run(
        'UPDATE pin_request_messages SET channel_id=?,message_id=? WHERE request_id=? AND message_id=?',
        [channelId, messageId, requestId, previousMessageId]
      );
      if (result.changes !== 1) throw new Error('PIN moderation message is already attached.');
      return Object.freeze({ requestId, channelId, messageId });
    },
    getModerationMessage(requestId) {
      return database.get('SELECT request_id AS requestId,channel_id AS channelId,message_id AS messageId FROM pin_request_messages WHERE request_id=?', [requestId]);
    }
  });
}

module.exports = { createSqlitePinRepository };
