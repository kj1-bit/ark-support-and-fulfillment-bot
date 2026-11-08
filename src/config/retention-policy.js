'use strict';

const DEFAULT_RETENTION_POLICY = Object.freeze({
  sessionGraceHours: 24,
  closedTicketDays: 365,
  completedPinDays: 30,
  operationalEventDays: 90,
  fulfillmentIdentityDays: 90,
  fulfillmentAuditDays: 365,
  intervalMinutes: 60
});

const RETENTION_BOUNDS = Object.freeze({
  sessionGraceHours: [1, 24 * 30],
  closedTicketDays: [1, 3650],
  completedPinDays: [1, 3650],
  operationalEventDays: [1, 3650],
  fulfillmentIdentityDays: [1, 3650],
  fulfillmentAuditDays: [1, 3650],
  intervalMinutes: [1, 24 * 60]
});

function resolveRetentionPolicy(overrides) {
  if (overrides !== undefined && (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new TypeError('retention must be an object.');
  }
  const policy = { ...DEFAULT_RETENTION_POLICY };
  for (const [key, value] of Object.entries(overrides || {})) {
    const bounds = RETENTION_BOUNDS[key];
    if (!bounds) throw new TypeError(`${key}: unknown retention setting`);
    if (!Number.isInteger(value) || value < bounds[0] || value > bounds[1]) {
      throw new TypeError(`${key}: integer from ${bounds[0]} through ${bounds[1]} required`);
    }
    policy[key] = value;
  }
  if (policy.fulfillmentIdentityDays > policy.fulfillmentAuditDays) {
    throw new TypeError('fulfillmentIdentityDays: cannot exceed fulfillmentAuditDays');
  }
  return Object.freeze(policy);
}

module.exports = { DEFAULT_RETENTION_POLICY, RETENTION_BOUNDS, resolveRetentionPolicy };
