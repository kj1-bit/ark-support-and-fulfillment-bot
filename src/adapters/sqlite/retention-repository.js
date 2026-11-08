'use strict';

const TERMINAL_FULFILLMENT = "('SUCCEEDED','PARTIAL','FAILED','UNCERTAIN','CANCELED','EXPIRED')";
const REDACTED = 'REDACTED';

function createSqliteRetentionRepository(database) {
  if (!database || typeof database.run !== 'function') {
    throw new TypeError('database run interface is required.');
  }
  const changes = async (sql, args) => (await database.run(sql, args)).changes || 0;

  return Object.freeze({
    expirePinRequests: (now) => changes(
      `UPDATE pin_requests SET state='EXPIRED', protected_pin=NULL, updated_at=?
       WHERE state IN ('PENDING','APPROVED') AND expires_at<=?`,
      [now, now]
    ),
    clearTerminalPinMaterial: (now) => changes(
      `UPDATE pin_requests SET protected_pin=NULL, updated_at=?
       WHERE state IN ('DELIVERED','CANCELED','EXPIRED') AND protected_pin IS NOT NULL`,
      [now]
    ),
    purgePinRequests: (cutoff) => changes(
      `DELETE FROM pin_requests
       WHERE state IN ('DELIVERED','CANCELED','EXPIRED') AND updated_at<?`,
      [cutoff]
    ),
    purgeSessions: (cutoff) => changes('DELETE FROM interaction_sessions WHERE expires_at<?', [cutoff]),
    purgeClosedTickets: (cutoff) => changes(
      "DELETE FROM tickets WHERE state='CLOSED' AND updated_at<?",
      [cutoff]
    ),
    purgeOperationalEvents: (cutoff) => changes('DELETE FROM operational_events WHERE occurred_at<?', [cutoff]),
    expireFulfillmentRequests: (now) => changes(
      `UPDATE fulfillment_requests SET state='EXPIRED', completed_at=?
       WHERE state='PENDING' AND expires_at<=?`,
      [now, now]
    ),
    recoverInterruptedFulfillment: async (now) => {
      const failed = await changes(
        `UPDATE fulfillment_requests SET state='FAILED', completed_at=?
         WHERE state='CLAIMED'`,
        [now]
      );
      const uncertain = await changes(
        `UPDATE fulfillment_requests SET state='UNCERTAIN', completed_at=?
         WHERE state='EXECUTING'`,
        [now]
      );
      return Object.freeze({ failed, uncertain });
    },
    anonymizeFulfillmentIdentity: (cutoff) => changes(
      `UPDATE fulfillment_requests SET eos_id=?, player_ref=?, player_name=?
       WHERE state IN ${TERMINAL_FULFILLMENT}
         AND COALESCE(completed_at, expires_at)<?
         AND (eos_id<>? OR player_ref IS NOT ? OR player_name IS NOT ?)`,
      [REDACTED, REDACTED, REDACTED, cutoff, REDACTED, REDACTED, REDACTED]
    ),
    purgeFulfillmentRequests: (cutoff) => changes(
      `DELETE FROM fulfillment_requests
       WHERE state IN ${TERMINAL_FULFILLMENT} AND COALESCE(completed_at, expires_at)<?`,
      [cutoff]
    )
  });
}

module.exports = { REDACTED, createSqliteRetentionRepository };
