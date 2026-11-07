'use strict';
const { requireIdentifier } = require('../contracts/identifiers');
const SUPPORTED = new Set(['listOnlinePlayers', 'fulfillApprovedCreature']);
function createServerRegistry(servers) {
  if (!Array.isArray(servers) || servers.length === 0) throw new TypeError('Server registry requires entries.');
  const map = new Map();
  for (const source of servers) {
    const id = requireIdentifier('serverId', source?.id);
    if (map.has(id)) throw new TypeError(`Duplicate server ID: ${id}`);
    if (source.enabled !== true) continue;
    if (!Array.isArray(source.operations) || source.operations.length === 0) throw new TypeError(`Server ${id} requires operations.`);
    for (const op of source.operations) if (!SUPPORTED.has(op)) throw new TypeError(`Unsupported operation ${op} for ${id}.`);
    map.set(id, Object.freeze({ ...source, operations: Object.freeze([...source.operations]) }));
  }
  if (!map.size) throw new TypeError('Server registry requires an enabled server.');
  return Object.freeze({
    get(id, operation) {
      requireIdentifier('serverId', id);
      const server = map.get(id);
      if (!server || !server.operations.includes(operation)) throw new Error('Server operation is not allowed.');
      return server;
    },
    list() { return Object.freeze([...map.values()]); }
  });
}
module.exports = { createServerRegistry, SUPPORTED };
