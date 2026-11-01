const assert = require('assert');
const catalog = require('../data/dino-catalog.json');

const REQUIRED_KEYS = [
  'id', 'name', 'aliases', 'blueprint', 'tameable',
  'supportsGender', 'saddleApplicable', 'sourceMod', 'deliveryMode', 'enabled'
];
const BLOCKED = /(?:^|[\s_\/-])(alpha|boss|minion|mission|outpost|summoned|corrupt(?:ed)?|ghost|zombie|cave|test|dododrex|dodo[\s_-]*wyvern)(?:$|[\s_\/-])/i;
const NORMALIZED = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ids = new Map();
const blueprints = new Map();
const searchTerms = new Map();

assert(Array.isArray(catalog), 'Catalog must be an array.');
assert(catalog.length > 0, 'Catalog must not be empty.');

for (const creature of catalog) {
  for (const key of REQUIRED_KEYS) {
    assert(Object.prototype.hasOwnProperty.call(creature, key), `${creature.id || creature.name || 'Entry'} is missing ${key}.`);
  }

  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(creature.id), `${creature.id} has an invalid ID.`);
  assert(typeof creature.name === 'string' && creature.name.trim(), `${creature.id} has an invalid name.`);
  assert(Array.isArray(creature.aliases) && creature.aliases.every(alias => typeof alias === 'string' && alias.trim()), `${creature.id} has invalid aliases.`);
  assert(/^\/(?:Game|[A-Za-z0-9_-]+)\/.+\.[A-Za-z0-9_]+$/.test(creature.blueprint), `${creature.id} must use a path-only blueprint.`);
  assert(!/^Blueprint['\"]/i.test(creature.blueprint) && !/_C$/i.test(creature.blueprint), `${creature.id} blueprint contains a wrapper or class suffix.`);
  assert(typeof creature.tameable === 'boolean', `${creature.id} tameable must be boolean.`);
  assert(typeof creature.supportsGender === 'boolean', `${creature.id} supportsGender must be boolean.`);
  assert(typeof creature.saddleApplicable === 'boolean', `${creature.id} saddleApplicable must be boolean.`);
  assert(typeof creature.sourceMod === 'string' && creature.sourceMod.trim(), `${creature.id} has an invalid sourceMod.`);
  assert(typeof creature.enabled === 'boolean', `${creature.id} enabled must be boolean.`);
  assert(['pair', 'single', 'single-random', 'unsupported'].includes(creature.deliveryMode), `${creature.id} has an invalid deliveryMode.`);
  if (creature.deliveryMode === 'pair') assert.strictEqual(creature.supportsGender, true, `${creature.id} pair delivery requires gender support.`);
  if (creature.requiresDlc !== undefined) assert(typeof creature.requiresDlc === 'boolean', `${creature.id} requiresDlc must be boolean.`);
  if (creature.requiresDlc) assert(typeof creature.dlcName === 'string' && creature.dlcName.trim(), `${creature.id} requires a dlcName.`);
  assert(!BLOCKED.test(`${creature.id} ${creature.name} ${creature.blueprint} ${creature.sourceMod}`), `${creature.id} matches a blocked catalog variant.`);
  if (creature.enabled) assert.strictEqual(creature.tameable, true, `${creature.id} is enabled but not tameable.`);

  const idKey = creature.id.toLowerCase();
  const blueprintKey = creature.blueprint.toLowerCase();
  assert(!ids.has(idKey), `Duplicate ID: ${creature.id}.`);
  assert(!blueprints.has(blueprintKey), `Duplicate blueprint: ${creature.blueprint}.`);
  ids.set(idKey, creature.id);
  blueprints.set(blueprintKey, creature.id);
}

for (const creature of catalog) {
  const terms = [creature.id, creature.name, ...creature.aliases];
  const local = new Set();
  for (const term of terms) {
    const key = NORMALIZED(term);
    assert(key, `${creature.id} contains an empty search term.`);
    if (local.has(key)) continue;
    local.add(key);
    const owner = searchTerms.get(key);
    assert(!owner || owner === creature.id, `Search term "${term}" clashes between ${owner} and ${creature.id}.`);
    searchTerms.set(key, creature.id);
  }
}

const expected = {
  achatina: { supportsGender: false, saddleApplicable: false },
  argentavis: { supportsGender: true, saddleApplicable: true },
  direwolf: { supportsGender: true, saddleApplicable: false },
  rex: { supportsGender: true, saddleApplicable: true },
  'tek-rex': { supportsGender: true, saddleApplicable: true },
  tusoteuthis: { supportsGender: true, saddleApplicable: true }
};
for (const [id, values] of Object.entries(expected)) {
  const creature = catalog.find(entry => entry.id === id);
  assert(creature, `Representative creature ${id} is missing.`);
  assert.strictEqual(creature.supportsGender, values.supportsGender, `${id} gender rule changed.`);
  assert.strictEqual(creature.saddleApplicable, values.saddleApplicable, `${id} saddle rule changed.`);
}

console.log(`Catalog audit passed for ${catalog.length} entries.`);
