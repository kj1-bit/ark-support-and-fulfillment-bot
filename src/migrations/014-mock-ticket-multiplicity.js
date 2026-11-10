'use strict';

module.exports = Object.freeze({
  version: 14,
  name: 'mock-ticket-multiplicity',
  statements: Object.freeze([
    'ALTER TABLE tickets ADD COLUMN mock_multiple INTEGER NOT NULL DEFAULT 0 CHECK(mock_multiple IN (0,1))',
    'DROP INDEX idx_ticket_requester_active',
    `CREATE UNIQUE INDEX idx_ticket_requester_active ON tickets(guild_id,actor_id)
     WHERE channel_status IS NOT NULL AND state IN ('OPEN','CLAIMED') AND mock_multiple=0`
  ])
});
