'use strict';

const TYPES = Object.freeze(['SUPPORT','PIN','PLAYER_NAME','SHOP','FULFILLMENT']);
const STATES = Object.freeze({ OPEN:'OPEN', CLAIMED:'CLAIMED', COMPLETED:'COMPLETED', CLOSED:'CLOSED' });

function validateText(value) {
  const text = String(value || '').trim().replace(/ +/g, ' ');
  if (!text || text.length > 1000 || /[\0\r]/.test(text)) throw new TypeError('Ticket description is invalid.');
  return text;
}

function createTicketService({ repository, playerNames, authorization, audit, clock = Date.now, uuid, channelConfig }) {
  if (!repository || typeof repository.create !== 'function' || typeof repository.claim !== 'function'
    || typeof repository.transition !== 'function') throw new TypeError('ticket repository interface is required.');
  if (!playerNames || typeof playerNames.get !== 'function') throw new TypeError('playerNames.get is required.');
  if (!authorization || typeof authorization.authorize !== 'function') throw new TypeError('authorization.authorize is required.');
  if (!audit || typeof audit.write !== 'function') throw new TypeError('audit.write is required.');
  if (typeof uuid !== 'function') throw new TypeError('uuid is required.');
  let gateway;
  const locks = new Map();

  function exclusive(id, action) {
    const prior = locks.get(id) || Promise.resolve();
    const work = prior.catch(() => {}).then(action);
    locks.set(id, work);
    return work.finally(() => { if (locks.get(id) === work) locks.delete(id); });
  }

  async function checked(input, allowRequester = false) {
    const record = await repository.get(input.ticketId);
    if (!record) throw new Error('Ticket not found.');
    if (record.guildId !== input.context.guildId) throw new Error('This operation is not authorized.');
    if (record.channelStatus) {
      const permitted = [record.channelId, channelConfig.channels.requests, channelConfig.channels.ticketLogs];
      if (!permitted.includes(input.context.channelId)) throw new Error('This operation is not authorized.');
      if (input.context.messageId
        && (input.context.channelId !== record.channelId || input.context.messageId !== record.messageId)) {
        throw new Error('This ticket control is no longer valid.');
      }
    }
    if (!allowRequester || record.actorId !== input.context.actorId) {
      authorization.authorize(record.channelStatus && input.context.channelId === record.channelId
        ? 'tickets.channel-moderate' : 'tickets.moderate', input.context);
    }
    return record;
  }

  async function sync(record) {
    if (!record.channelStatus) return record;
    if (!gateway) throw new Error('Ticket channel service is unavailable.');
    const replacementId = await gateway.sync(record);
    if (replacementId) await repository.attachMessage(record.id, replacementId);
    return repository.setChannelStatus(record.id, record.state === STATES.CLOSED ? 'ARCHIVED' : 'ACTIVE');
  }

  // A persisted transition whose Discord sync failed leaves channel_status behind the ticket state;
  // repeating the same action re-applies the sync instead of rejecting the already-applied transition.
  function unsynced(record, closed) {
    return closed
      ? record.state === STATES.CLOSED && record.channelStatus === 'ACTIVE'
      : record.state !== STATES.CLOSED && record.channelStatus === 'ARCHIVED';
  }

  async function syncAudited(record, phase) {
    try { return await sync(record); }
    catch (error) { audit.write('ticket.channel_failed', { id:record.id, phase }); throw error; }
  }

  async function preflight(record) {
    if (!['ACTIVE','ARCHIVED'].includes(record?.channelStatus)) return;
    if (!gateway) throw new Error('Ticket channel service is unavailable.');
    try { await gateway.verify(record); }
    catch (error) {
      audit.write('ticket.channel_failed', { id:record.id, phase:'permissions', missing:error.missing || [] });
      throw error;
    }
  }

  return Object.freeze({
    connectChannels(value) { gateway = value; },
    async create(input) {
      if (!TYPES.includes(input.type)) throw new TypeError('Unsupported ticket type.');
      if (channelConfig && (input.context.guildId !== channelConfig.guildId
        || input.context.channelId !== channelConfig.channels.requests)) {
        throw new Error('Open requests from the configured request channel.');
      }
      const player = await playerNames.get(input.context.actorId);
      if (!player || player.status !== 'VERIFIED') throw new Error('A verified player name is required.');
      const description = validateText(input.description);
      if (channelConfig && !gateway) throw new Error('Ticket channel service is unavailable.');
      return exclusive(`${input.context.guildId}:${input.context.actorId}`, async () => {
        if (channelConfig) {
          const active = await repository.findActive(input.context.guildId, input.context.actorId);
          if (active) {
            const link = active.channelStatus && active.channelStatus !== 'PROVISIONING' ? ` <#${active.channelId}>` : '';
            throw Object.assign(new Error(`You already have an open request:${link || ' creation is in progress.'}`), {
              code:'TICKET_ALREADY_OPEN', ticketChannelId:link ? active.channelId : null
            });
          }
        }
        let record = await repository.create({
          id:`TKT-${uuid()}`, type:input.type, description, actorId:input.context.actorId,
          playerName:player.playerName, guildId:input.context.guildId, channelId:input.context.channelId,
          state:STATES.OPEN, createdAt:clock(), updatedAt:clock(),
          ...(channelConfig ? { channelStatus:'PROVISIONING' } : {})
        });
        if (channelConfig) {
          let channelId;
          try {
            channelId = await gateway.create(record, input.username);
          } catch (error) {
            await repository.failProvisioning(record.id, clock());
            audit.write('ticket.channel_failed', { id:record.id, phase:'create' });
            throw error;
          }
          try {
            record = await repository.attachChannel(record.id, channelId, clock());
          } catch (error) {
            audit.write('ticket.channel_failed', { id:record.id, phase:'persist', channelId });
            // The channel topic contains the reservation ID for startup recovery.
            throw error;
          }
          try {
            const messageId = await gateway.post(record);
            record = await repository.attachMessage(record.id, messageId);
          } catch (error) {
            audit.write('ticket.channel_failed', { id:record.id, phase:'message' });
            throw error;
          }
        }
        audit.write('ticket.created', record);
        return record;
      });
    },
    claim(input) {
      return exclusive(input.ticketId, async () => {
        if (channelConfig) await checked(input);
        else authorization.authorize('tickets.moderate', input.context);
        const record = await repository.claim(input.ticketId, input.context.actorId, clock());
        audit.write('ticket.claimed', record);
        return sync(record);
      });
    },
    complete(input) {
      return exclusive(input.ticketId, async () => {
        await checked(input);
        const record = await repository.complete(input.ticketId, input.context.actorId, clock());
        audit.write('ticket.completed', record);
        return sync(record);
      });
    },
    close(input) {
      return exclusive(input.ticketId, async () => {
        let current = null;
        if (channelConfig) current = await checked(input, true);
        else authorization.authorize('tickets.moderate', input.context);
        if (current && unsynced(current, true)) return syncAudited(current, 'archive');
        await preflight(current);
        const record = await repository.transition(input.ticketId, [STATES.OPEN,STATES.CLAIMED], STATES.CLOSED, {
          moderatorId:input.context.actorId, updatedAt:clock()
        });
        audit.write('ticket.closed', record);
        return syncAudited(record, 'archive');
      });
    },
    reopen(input) {
      return exclusive(input.ticketId, async () => {
        let existing = null;
        if (channelConfig) existing = await checked(input);
        else authorization.authorize('tickets.moderate', input.context);
        if (['DELETED','FAILED'].includes(existing?.channelStatus)) {
          throw new Error('The retained ticket channel is unavailable.');
        }
        if (existing && unsynced(existing, false)) return syncAudited(existing, 'reopen');
        await preflight(existing);
        const record = await repository.transition(input.ticketId, [STATES.CLOSED], STATES.OPEN, {
          moderatorId:input.context.actorId, updatedAt:clock()
        });
        audit.write('ticket.reopened', record);
        return syncAudited(record, 'reopen');
      });
    },
    async recoverChannels() {
      if (!channelConfig || !gateway) return;
      const failures = [];
      try { await gateway.verify(); }
      catch (error) {
        audit.write('ticket.channel_failed', { phase:'permissions', missing:error.missing || [] });
        failures.push(error);
      }
      for (const initial of await repository.listChannels()) {
        await exclusive(initial.id, async () => {
          let record = await repository.get(initial.id);
          try {
            if (record.channelStatus === 'PROVISIONING') {
              const channelId = await gateway.find(record);
              if (!channelId) {
                await repository.failProvisioning(record.id, clock());
                audit.write('ticket.channel_failed', { id:record.id, phase:'interrupted' });
                return;
              }
              record = await repository.attachChannel(record.id, channelId, clock());
            }
            if (!record.messageId) record = await repository.attachMessage(record.id, await gateway.post(record));
            await sync(record);
          } catch (error) {
            if (error.code === 10003 && record.channelStatus !== 'PROVISIONING') {
              await repository.markChannelDeleted(record.id, clock());
              audit.write('ticket.channel_failed', { id:record.id, phase:'missing', state:'CLOSED' });
              return;
            }
            audit.write('ticket.channel_failed', { id:record.id, phase:'recover' });
            failures.push(error);
          }
        });
      }
      if (failures.length) throw new AggregateError(failures, 'Ticket channel recovery was incomplete.');
    },
    async channelDeleted(channelId, guildId) {
      if (!channelConfig || guildId !== channelConfig.guildId) return;
      const record = (await repository.listChannels()).find(ticket => ticket.channelId === channelId);
      if (!record) return;
      return exclusive(record.id, async () => {
        const live = await repository.get(record.id);
        if (!live || live.channelStatus === 'DELETED') return;
        await repository.markChannelDeleted(record.id, clock());
        audit.write('ticket.channel_failed', { id:record.id, phase:'deleted', state:'CLOSED' });
      });
    },
    async controlDeleted(messageId, channelId, guildId) {
      if (!channelConfig || guildId !== channelConfig.guildId) return;
      const record = (await repository.listChannels()).find(ticket => ticket.channelId === channelId
        && ticket.messageId === messageId);
      if (!record) return;
      return exclusive(record.id, async () => {
        const live = await repository.get(record.id);
        if (!live || live.messageId !== messageId || live.channelStatus === 'DELETED') return;
        await sync(live);
      });
    },
    async purgeChannels(cutoff) {
      if (!channelConfig || !gateway) throw new Error('Ticket channel service is unavailable.');
      for (const record of await repository.listExpiredChannels(cutoff)) {
        try {
          await exclusive(record.id, async () => {
            const live = await repository.get(record.id);
            if (!live || live.state !== STATES.CLOSED) return;
            await gateway.remove(live);
            await repository.setChannelStatus(live.id, 'DELETED');
          });
        } catch {
          audit.write('ticket.channel_failed', { id:record.id, phase:'purge' });
        }
      }
    }
  });
}

module.exports = { TYPES, STATES, validateText, createTicketService };
