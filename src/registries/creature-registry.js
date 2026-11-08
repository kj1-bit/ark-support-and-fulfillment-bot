'use strict';
const crypto = require('node:crypto');
const { requireIdentifier } = require('../contracts/identifiers');
const BLUEPRINT = /^\/[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+$/;
const MODES = new Set(['pair', 'single', 'single-random']);
function validateCatalog(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Catalog is required.');
  requireIdentifier('catalogVersion', input.version);
  if (!Array.isArray(input.creatures) || input.creatures.length === 0) throw new TypeError('Catalog creatures are required.');
  const ids = new Set();
  const creatures = input.creatures.map(item => {
    const id = requireIdentifier('creatureId', item?.id);
    if (ids.has(id)) throw new TypeError(`Duplicate creature ID: ${id}`);
    ids.add(id);
    if (typeof item.name !== 'string' || !item.name.trim()) throw new TypeError(`Creature ${id} requires a name.`);
    if (!BLUEPRINT.test(item.blueprint || '')) throw new TypeError(`Creature ${id} has an unsafe blueprint.`);
    if (item.enabled !== true || item.tameable !== true) throw new TypeError(`Creature ${id} is not enabled and tameable.`);
    if (!MODES.has(item.deliveryMode)) throw new TypeError(`Creature ${id} has an invalid delivery mode.`);
    if (item.deliveryMode === 'pair' && item.supportsGender !== true) throw new TypeError(`Creature ${id} has contradictory gender settings.`);
    if (typeof item.saddleApplicable !== 'boolean') throw new TypeError(`Creature ${id} requires saddleApplicable.`);
    return Object.freeze({ ...item, aliases: Object.freeze([...(item.aliases || [])]) });
  });
  const canonical = JSON.stringify({ version: input.version, creatures });
  return Object.freeze({ version: input.version, checksum: crypto.createHash('sha256').update(canonical).digest('hex'), creatures: Object.freeze(creatures) });
}
function createCreatureRegistry(catalog) {
  const valid = validateCatalog(catalog); const map = new Map(valid.creatures.map(c => [c.id, c]));
  return Object.freeze({ version: valid.version, checksum: valid.checksum, creatures: valid.creatures, get(id) { requireIdentifier('creatureId', id); const c=map.get(id); if(!c) throw new Error('Unknown creature.'); return c; }, list(){return valid.creatures;} });
}
function diffCatalogs(current, proposed) {
  const a=new Map(current.creatures.map(x=>[x.id,x])); const b=new Map(proposed.creatures.map(x=>[x.id,x]));
  return Object.freeze({ added:[...b.keys()].filter(k=>!a.has(k)), removed:[...a.keys()].filter(k=>!b.has(k)), changed:[...b.keys()].filter(k=>a.has(k)&&JSON.stringify(a.get(k))!==JSON.stringify(b.get(k))) });
}
module.exports = { createCreatureRegistry, diffCatalogs, validateCatalog };
