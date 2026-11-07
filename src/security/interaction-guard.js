'use strict';

const crypto = require('node:crypto');
const { ERROR_CODES, safeError } = require('./safe-error');

function createInteractionGuard(options = {}) {
  const ttlMs = options.ttlMs ?? 15 * 60 * 1000;
  const now = options.now || Date.now;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const records = new Map();
  if (!Number.isInteger(ttlMs) || ttlMs < 1000) throw new TypeError('ttlMs must be an integer of at least 1000.');

  function issue(binding = {}) {
    for (const field of ['actorId', 'guildId', 'channelId', 'messageId', 'action']) {
      if (typeof binding[field] !== 'string' || !binding[field]) {
        throw safeError(ERROR_CODES.INTERACTION_CONTEXT_INVALID, 'Interaction context is invalid.');
      }
    }
    const token = randomUUID();
    records.set(token, Object.freeze({ ...binding, issuedAt: now(), expiresAt: now() + ttlMs, used: false }));
    return token;
  }

  function consume(token, context = {}) {
    const record = records.get(token);
    if (!record) throw safeError(ERROR_CODES.INTERACTION_CONTEXT_INVALID, 'Interaction context is invalid.');
    if (record.used) throw safeError(ERROR_CODES.INTERACTION_REPLAYED, 'This action has already been used.');
    if (now() > record.expiresAt) {
      records.delete(token);
      throw safeError(ERROR_CODES.INTERACTION_EXPIRED, 'This action has expired.');
    }
    for (const field of ['actorId', 'guildId', 'channelId', 'messageId', 'action']) {
      if (context[field] !== record[field]) throw safeError(ERROR_CODES.INTERACTION_CONTEXT_INVALID, 'Interaction context is invalid.');
    }
    records.set(token, Object.freeze({ ...record, used: true }));
    return Object.freeze({ ...record, token, used: true });
  }

  return Object.freeze({ issue, consume });
}

module.exports = { createInteractionGuard };
