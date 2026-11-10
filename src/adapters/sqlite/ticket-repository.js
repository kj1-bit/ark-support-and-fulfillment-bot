'use strict';

function publicTicket(row) {
  if (!row) return null;
  return {
    ...row,
    actorId: row.actor_id, guildId: row.guild_id, channelId: row.channel_id,
    sourceChannelId: row.source_channel_id, messageId: row.message_id,
    ticketNumber: row.ticket_number, channelStatus: row.channel_status,
    completedAt: row.completed_at, playerName: row.player_name, moderatorId: row.moderator_id,
    state: row.state !== 'CLOSED' && row.completed_at !== null && row.completed_at !== undefined
      ? 'COMPLETED' : row.state
  };
}

function createSqliteTicketRepository(database, { mode } = {}) {
  if (!database || typeof database.run !== 'function' || typeof database.get !== 'function') {
    throw new TypeError('database run/get interface is required.');
  }
  const mockMultiple = mode === 'mock' ? 1 : 0;
  const find = async id => publicTicket(await database.get('SELECT * FROM tickets WHERE id=?', [id]));
  return Object.freeze({
    get: find,
    async openPage(guildId, page = 1) {
      const pageSize = 5;
      const count = await database.get("SELECT COUNT(*) AS total FROM tickets WHERE guild_id=? AND state<>'CLOSED'", [guildId]);
      const total = Number(count.total);
      const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const rows = await database.all(
        `SELECT id,actor_id,player_name,guild_id,channel_id,channel_status,state,moderator_id,completed_at
         FROM tickets WHERE guild_id=? AND state<>'CLOSED' ORDER BY created_at,id LIMIT ? OFFSET ?`,
        [guildId,pageSize,(currentPage - 1) * pageSize]);
      return { page:currentPage,pageSize,total,results:rows.map(publicTicket) };
    },
    async findActive(guildId, actorId) {
      return publicTicket(await database.get(
        "SELECT * FROM tickets WHERE guild_id=? AND actor_id=? AND channel_status IS NOT NULL AND state IN ('OPEN','CLAIMED') ORDER BY created_at LIMIT 1",
        [guildId, actorId]
      ));
    },
    async create(r) {
      try {
        let result;
        if (r.channelStatus) {
          result = await database.run(
            `INSERT INTO tickets
             (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at,source_channel_id,channel_status,mock_multiple)
             SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
             WHERE ?=1 OR NOT EXISTS (SELECT 1 FROM tickets WHERE guild_id=? AND actor_id=?
               AND channel_status IS NOT NULL AND state IN ('OPEN','CLAIMED'))`,
            [r.id,r.type,r.description,r.actorId,r.playerName,r.guildId,r.channelId,r.state,r.createdAt,r.updatedAt,
              r.channelId,r.channelStatus,mockMultiple,mockMultiple,r.guildId,r.actorId]
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
        "UPDATE tickets SET state='CLAIMED',moderator_id=?,updated_at=? WHERE id=? AND state='OPEN'",
        [moderatorId, now, id]
      );
      if (result.changes !== 1) throw new Error('Ticket is missing or no longer open.');
      return find(id);
    },
    async unclaim(id, previousClaimant, now) {
      const result = await database.run(
        `UPDATE tickets SET state='OPEN',moderator_id=NULL,updated_at=?
         WHERE id=? AND state IN ('OPEN','CLAIMED') AND moderator_id IS ?`,
        [now,id,previousClaimant]);
      return result.changes === 1;
    },
    async complete(id, moderatorId, now) {
      const result = await database.run(
        "UPDATE tickets SET completed_at=?,updated_at=? WHERE id=? AND state IN ('OPEN','CLAIMED') AND completed_at IS NULL",
        [now, now, id]
      );
      if (result.changes !== 1) throw new Error('Ticket is missing, closed, or already completed.');
      return find(id);
    },
    async transition(id, fromStates, toState, meta) {
      const states = fromStates.map(state => state === 'COMPLETED' ? 'CLAIMED' : state);
      const placeholders = states.map(() => '?').join(',');
      const result = await database.run(
        `UPDATE tickets SET state=?,updated_at=?${toState === 'OPEN' ? ',completed_at=NULL,moderator_id=NULL,mock_multiple=?' : ''}
         WHERE id=? AND state IN (${placeholders})
         ${toState === 'OPEN' ? `AND (?=1 OR channel_status IS NULL OR NOT EXISTS (
           SELECT 1 FROM tickets AS other WHERE other.guild_id=tickets.guild_id AND other.actor_id=tickets.actor_id
           AND other.id<>tickets.id AND other.channel_status IS NOT NULL AND other.state IN ('OPEN','CLAIMED'))) ` : ''}`,
        [toState,meta.updatedAt,...(toState === 'OPEN' ? [mockMultiple] : []),id,...states,
          ...(toState === 'OPEN' ? [mockMultiple] : [])]
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
