'use strict';

const { transition } = require('../../domain/fulfillment/state-machine');

function parse(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    idempotencyKey: row.idempotency_key,
    actorId: row.actor_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    creatureId: row.creature_id,
    catalogVersion: row.catalog_version,
    serverId: row.server_id,
    playerRef: row.player_ref,
    playerName: row.player_name,
    eosId: row.eos_id,
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    results: row.result_json ? JSON.parse(row.result_json) : undefined
  });
}

function createSqliteFulfillmentRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.get !== 'function') {
    throw new TypeError('database run/get interface is required.');
  }

  const repository = {
    async create(record) {
      await database.run(
        `INSERT INTO fulfillment_requests (
           id, idempotency_key, actor_id, guild_id, channel_id, message_id,
           creature_id, catalog_version, server_id, player_ref, player_name,
           eos_id, state, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id, record.idempotencyKey, record.actorId, record.guildId,
          record.channelId, record.messageId, record.creatureId,
          record.catalogVersion, record.serverId, record.playerRef,
          record.playerName, record.eosId, record.state, record.createdAt,
          record.expiresAt
        ]
      );
      return repository.get(record.id);
    },

    async get(id) {
      return parse(await database.get('SELECT * FROM fulfillment_requests WHERE id = ?', [id]));
    },

    async claim(id, actorId, now) {
      const result = await database.run(
        `UPDATE fulfillment_requests
         SET state = 'CLAIMED', claimed_at = ?
         WHERE id = ? AND actor_id = ? AND state = 'PENDING' AND expires_at >= ?`,
        [now, id, actorId, now]
      );
      if (result.changes !== 1) throw new Error('Fulfillment request cannot be claimed.');
      return repository.get(id);
    },

    async update(id, nextState, patch = {}) {
      const current = await repository.get(id);
      if (!current) throw new Error('Fulfillment request not found.');
      transition(current.state, nextState);
      const resultJson = patch.results === undefined ? null : JSON.stringify(patch.results);
      const result = await database.run(
        `UPDATE fulfillment_requests
         SET state = ?, completed_at = COALESCE(?, completed_at),
             result_json = COALESCE(?, result_json)
         WHERE id = ? AND state = ?`,
        [nextState, patch.completedAt ?? null, resultJson, id, current.state]
      );
      if (result.changes !== 1) {
        throw new Error('Fulfillment request changed before the update completed.');
      }
      return repository.get(id);
    }
  };

  return Object.freeze(repository);
}

module.exports = { createSqliteFulfillmentRepository, parse };
