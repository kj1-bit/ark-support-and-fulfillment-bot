'use strict';

function publicTicket(row) {
  if (!row) return null;
  return {
    ...row,
    actorId: row.actor_id, guildId: row.guild_id, channelId: row.channel_id,
    sourceChannelId: row.source_channel_id, messageId: row.message_id,
    ticketNumber: row.ticket_number, channelStatus: row.channel_status,
    completedAt: row.completed_at, playerName: row.player_name,
    state: row.state !== 'CLOSED' && row.completed_at !== null && row.completed_at !== undefined
      ? 'COMPLETED' : row.state
  };
}

function createSqliteTicketRepository(database) {
  if (!database || typeof database.run !== 'function' || typeof database.get !== 'function') {
    throw new TypeError('database run/get interface is required.');
  }
  const find = async id => publicTicket(await database.get('SELECT * FROM tickets WHERE id=?', [id]));
  return Object.freeze({
    get: find,
    async findActive(guildId, actorId) {
      return publicTicket(await database.get(
        "SELECT * FROM tickets WHERE guild_id=? AND actor_id=? AND state IN ('OPEN','CLAIMED') ORDER BY created_at LIMIT 1",
        [guildId, actorId]
      ));
    },
    async create(r) {
      try {
        let result;
        if (r.channelStatus) {
          result = await database.run(
            `INSERT INTO tickets
             (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at,source_channel_id,channel_status)
             SELECT ?,?,?,?,?,?,?,?,?,?,?,?
             WHERE NOT EXISTS (SELECT 1 FROM tickets WHERE guild_id=? AND actor_id=? AND state IN ('OPEN','CLAIMED'))`,
            [r.id,r.type,r.description,r.actorId,r.playerName,r.guildId,r.channelId,r.state,r.createdAt,r.updatedAt,
              r.channelId,r.channelStatus,r.guildId,r.actorId]
          );
          if (result.changes !== 1) throw new Error('An open ticket already exists for this player.');
        } else {
          await database.run(
            'INSERT INTO tickets (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [r.id,r.type,r.description,r.actorId,r.playerName,r.guildId,r.channelId,r.state,r.createdAt,r.updatedAt]
          );
        }
      } catch (error) {
        if (/unique/i.test(String(error.message))) {
          throw new Error('An open ticket already exists for this player and type.');
        }
        throw error;
      }
      return find(r.id);
    },
    async attachChannel(id, channelId, now) {
      const result = await database.run(
        "UPDATE tickets SET channel_id=?,channel_status='ACTIVE',updated_at=? WHERE id=? AND channel_status='PROVISIONING'",
        [channelId, now, id]
      );
      if (result.changes !== 1) throw new Error('Ticket channel reservation changed.');
      return find(id);
    },
    async attachMessage(id, messageId) {
      await database.run("UPDATE tickets SET message_id=? WHERE id=? AND channel_status IN ('ACTIVE','ARCHIVED')", [messageId, id]);
      return find(id);
    },
    async failProvisioning(id, now) {
      await database.run(
        "UPDATE tickets SET state='CLOSED',channel_status='FAILED',updated_at=? WHERE id=? AND channel_status='PROVISIONING'",
        [now, id]
      );
    },
    async setChannelStatus(id, status) {
      await database.run('UPDATE tickets SET channel_status=? WHERE id=?', [status, id]);
      return find(id);
    },
    async markChannelDeleted(id, now) {
      await database.run(
        "UPDATE tickets SET state='CLOSED',channel_status='DELETED',updated_at=? WHERE id=? AND channel_status IN ('ACTIVE','ARCHIVED')",
        [now,id]
      );
      return find(id);
    },
    async claim(id, moderatorId, now) {
      const result = await database.run(
        "UPDATE tickets SET state='CLAIMED',moderator_id=?,updated_at=? WHERE id=? AND state='OPEN' AND completed_at IS NULL",
        [moderatorId, now, id]
      );
      if (result.changes !== 1) throw new Error('Ticket is missing or no longer open.');
      return find(id);
    },
    async complete(id, moderatorId, now) {
      const result = await database.run(
        "UPDATE tickets SET completed_at=?,moderator_id=?,updated_at=? WHERE id=? AND state IN ('OPEN','CLAIMED') AND completed_at IS NULL",
        [now, moderatorId, now, id]
      );
      if (result.changes !== 1) throw new Error('Ticket is missing, closed, or already completed.');
      return find(id);
    },
    async transition(id, fromStates, toState, meta) {
      const states = fromStates.map(state => state === 'COMPLETED' ? 'CLAIMED' : state);
      const placeholders = states.map(() => '?').join(',');
      const result = await database.run(
        `UPDATE tickets SET state=?,moderator_id=?,updated_at=?${toState === 'OPEN' ? ',completed_at=NULL' : ''}
         WHERE id=? AND state IN (${placeholders})
         ${toState === 'OPEN' ? `AND (channel_status IS NULL OR NOT EXISTS (
           SELECT 1 FROM tickets AS other WHERE other.guild_id=tickets.guild_id AND other.actor_id=tickets.actor_id
           AND other.id<>tickets.id AND other.state IN ('OPEN','CLAIMED'))) ` : ''}`,
        [toState,meta.moderatorId,meta.updatedAt,id,...states]
      );
      if (result.changes !== 1) throw new Error('Ticket state changed concurrently or transition is invalid.');
      return find(id);
    },
    async listChannels() {
      return (await database.all("SELECT * FROM tickets WHERE channel_status IN ('PROVISIONING','ACTIVE','ARCHIVED')"))
        .map(publicTicket);
    },
    async listExpiredChannels(cutoff) {
      return (await database.all(
        "SELECT * FROM tickets WHERE state='CLOSED' AND channel_status IN ('ACTIVE','ARCHIVED') AND updated_at<?",
        [cutoff]
      )).map(publicTicket);
    }
  });
}

module.exports = { createSqliteTicketRepository, publicTicket };
