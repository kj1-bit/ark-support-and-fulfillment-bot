'use strict';

const ALLOWED_TYPES = Object.freeze([
  'ticket.created',
  'ticket.claimed',
  'ticket.closed',
  'ticket.reopened',
  'pin.requested',
  'pin.approved',
  'pin.delivered',
  'pin.canceled',
  'fulfillment.succeeded',
  'fulfillment.failed',
  'catalog.activated',
  'catalog.rolled-back'
]);

const FORBIDDEN_KEYS = /pin|protected|secret|token|password|eos|error|stack|command|blueprint/i;

function sanitizeDetails(value, depth = 0) {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return typeof value === 'string' ? value.slice(0, 256) : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => sanitizeDetails(item, depth + 1));
  }
  if (typeof value !== 'object') return undefined;

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    const safe = sanitizeDetails(item, depth + 1);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function createOperationalEventService({ repository, clock = Date.now }) {
  if (!repository || typeof repository.append !== 'function' || typeof repository.query !== 'function') {
    throw new TypeError('operational event repository interface is required.');
  }

  return Object.freeze({
    async record(type, details = {}) {
      if (!ALLOWED_TYPES.includes(type)) {
        throw new TypeError('Unsupported operational event type.');
      }
      const event = Object.freeze({
        type,
        category: type.split('.')[0],
        occurredAt: clock(),
        details: Object.freeze(sanitizeDetails(details))
      });
      return repository.append(event);
    },

    async page(input = {}) {
      const page = Math.max(1, Math.min(1000, Number.parseInt(input.page, 10) || 1));
      const pageSize = Math.max(1, Math.min(25, Number.parseInt(input.pageSize, 10) || 10));
      const category = input.category === undefined ? null : String(input.category);
      if (category && !['ticket', 'pin', 'fulfillment', 'catalog'].includes(category)) {
        throw new TypeError('Unsupported dashboard category.');
      }
      return repository.query({ page, pageSize, category });
    }
  });
}

module.exports = { ALLOWED_TYPES, sanitizeDetails, createOperationalEventService };
