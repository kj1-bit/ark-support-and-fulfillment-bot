'use strict';

module.exports = Object.freeze({
  version: 7,
  name: 'fulfillment-targets',
  statements: Object.freeze([
    `ALTER TABLE fulfillment_requests ADD COLUMN player_ref TEXT`,
    `ALTER TABLE fulfillment_requests ADD COLUMN player_name TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_fulfillment_player_ref ON fulfillment_requests(player_ref)`
  ])
});
