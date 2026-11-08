'use strict';
const PATTERNS = Object.freeze({
  snowflake: /^[1-9][0-9]{16,19}$/,
  serverId: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  creatureId: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  requestId: /^FUL-[0-9a-f-]{36}$/i,
  eosId: /^[0-9a-f]{32}$/i,
  catalogVersion: /^[0-9]{4}\.[0-9]{1,3}\.[0-9]{1,3}(?:-[a-z0-9.-]+)?$/
});
function requireIdentifier(kind, value) {
  const pattern = PATTERNS[kind];
  if (!pattern) throw new TypeError(`Unknown identifier kind: ${kind}`);
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`Invalid ${kind}.`);
  return value;
}
module.exports = { PATTERNS, requireIdentifier };
