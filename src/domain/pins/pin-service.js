'use strict';

const STATES = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DELIVERED: 'DELIVERED',
  CANCELED: 'CANCELED',
  EXPIRED: 'EXPIRED'
});

function validatePin(value) {
  const pin = String(value || '');
  if (!/^\d{4}$/.test(pin)) throw new TypeError('PIN must contain exactly four digits.');
  return pin;
}

function createPinService({
  repository,
  playerNames,
  authorization,
  protector,
  audit,
  clock = Date.now,
  uuid,
  ttlMs = 86400000
}) {
  if (!repository || typeof repository.create !== 'function'
    || typeof repository.get !== 'function' || typeof repository.transition !== 'function'
    || typeof repository.expireStale !== 'function') {
    throw new TypeError('PIN repository interface is required.');
  }
  if (!playerNames || typeof playerNames.get !== 'function') throw new TypeError('playerNames.get is required.');
  if (!authorization || typeof authorization.authorize !== 'function') throw new TypeError('authorization.authorize is required.');
  if (!protector || typeof protector.protect !== 'function' || typeof protector.reveal !== 'function') {
    throw new TypeError('PIN protector interface is required.');
  }
  if (!audit || typeof audit.write !== 'function') throw new TypeError('audit.write is required.');
  if (typeof uuid !== 'function') throw new TypeError('uuid is required.');

  function toModerationView(row) {
    return Object.freeze({
      id: row.id,
      actorId: row.actorId,
      playerName: row.playerName,
      guildId: row.guildId,
      state: row.state,
      createdAt: row.createdAt,
      moderation: row.messageId ? Object.freeze({ channelId: row.messageChannelId, messageId: row.messageId }) : null
    });
  }

  // Buttons on a staff moderation message may act only on the request that message was posted for.
  async function assertBoundMessage(input) {
    if (input.requireBoundMessage !== true) return;
    if (typeof repository.getModerationMessage !== 'function') throw new Error('PIN moderation message is mismatched.');
    const bound = await repository.getModerationMessage(input.requestId);
    if (!bound || !input.context?.messageId || bound.messageId !== input.context.messageId
      || bound.channelId !== input.context.channelId) {
      throw new Error('PIN moderation message is mismatched.');
    }
  }

  return Object.freeze({
    async request(input) {
      const player = await playerNames.get(input.context.actorId);
      if (!player || player.status !== 'VERIFIED') throw new Error('A verified player name is required.');
      const protectedPin = await protector.protect(validatePin(input.pin));
      const now = clock();
      await repository.expireStale(input.context.actorId, now);
      const record = await repository.create({
        id: `PIN-${uuid()}`,
        actorId: input.context.actorId,
        playerName: player.playerName,
        guildId: input.context.guildId,
        channelId: input.context.channelId,
        protectedPin,
        state: STATES.PENDING,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + ttlMs
      });
      audit.write('pin.requested', { id: record.id, actorId: record.actorId, state: record.state });
      return record;
    },

    async approve(input) {
      authorization.authorize('pins.moderate', input.context);
      await assertBoundMessage(input);
      const existing = await repository.get(input.requestId);
      if (existing && existing.expiresAt <= clock()) throw new Error('PIN request has expired.');
      const record = await repository.transition(input.requestId, [STATES.PENDING], STATES.APPROVED, {
        moderatorId: input.context.actorId,
        updatedAt: clock()
      });
      audit.write('pin.approved', { id: record.id, moderatorId: input.context.actorId, state: record.state });
      return record;
    },

    async deliver(input) {
      authorization.authorize('pins.deliver', input.context);
      if (typeof input.deliver !== 'function') throw new TypeError('A private PIN delivery function is required.');
      await assertBoundMessage(input);
      const record = await repository.get(input.requestId);
      if (!record || record.state !== STATES.APPROVED) throw new Error('PIN request is not approved.');
      if (record.expiresAt <= clock()) throw new Error('PIN request has expired.');
      const pin = await protector.reveal(record.protectedPin);
      const delivered = await input.deliver(pin, record);
      if (delivered !== true) throw new Error('PIN delivery did not confirm success.');
      const result = await repository.transition(input.requestId, [STATES.APPROVED], STATES.DELIVERED, {
        moderatorId: input.context.actorId,
        updatedAt: clock(),
        clearProtectedPin: true
      });
      audit.write('pin.delivered', { id: result.id, moderatorId: input.context.actorId, state: result.state });
      return result;
    },

    async cancel(input) {
      const record = await repository.get(input.requestId);
      if (!record) throw new Error('PIN request not found.');
      if (record.actorId !== input.context.actorId) {
        authorization.authorize('pins.moderate', input.context);
      }
      await assertBoundMessage(input);
      const canceled = await repository.transition(
        input.requestId,
        [STATES.PENDING, STATES.APPROVED],
        STATES.CANCELED,
        { moderatorId: input.context.actorId, updatedAt: clock(), clearProtectedPin: true }
      );
      audit.write('pin.canceled', { id: canceled.id, state: canceled.state });
      return canceled;
    },

    async attachModerationMessage(input) {
      if (typeof repository.attachModerationMessage !== 'function') {
        throw new TypeError('PIN moderation message persistence is unavailable.');
      }
      const record = await repository.get(input.requestId);
      if (!record || ![STATES.PENDING, STATES.APPROVED].includes(record.state)) throw new Error('PIN request is not open.');
      return repository.attachModerationMessage({
        requestId: record.id,
        channelId: String(input.channelId),
        messageId: String(input.messageId),
        createdAt: clock()
      });
    },

    // Startup-only listing for restoring staff controls; returns no protected material.
    async outstandingModeration({ guildId, limit = 100, after = null }) {
      if (typeof repository.listOpenWithModeration !== 'function') return [];
      const size = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 100));
      const rows = await repository.listOpenWithModeration({ guildId, now: clock(), limit: size, after });
      return rows.map(toModerationView);
    },

    async moderationRecord(requestId) {
      if (typeof repository.getOpenWithModeration !== 'function') return null;
      const row = await repository.getOpenWithModeration(requestId, clock());
      return row ? toModerationView(row) : null;
    },

    async rebindModerationMessage(input) {
      if (typeof repository.rebindModerationMessage !== 'function') {
        throw new TypeError('PIN moderation message persistence is unavailable.');
      }
      const record = await repository.get(input.requestId);
      if (!record || ![STATES.PENDING, STATES.APPROVED].includes(record.state)) throw new Error('PIN request is not open.');
      return repository.rebindModerationMessage({
        requestId: record.id,
        channelId: String(input.channelId),
        previousMessageId: String(input.previousMessageId),
        messageId: String(input.messageId)
      });
    }
  });
}

module.exports = { STATES, validatePin, createPinService };
