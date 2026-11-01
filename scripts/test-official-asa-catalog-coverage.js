const assert = require('assert');
const reviewed = require('../data/official-asa-reviewed-candidates.json');
const enriched = require('../data/official-asa-enriched-candidates.json');
const catalog = require('../data/dino-catalog.json');
const { buildFulfillmentCommands } = require('../services/aat-command-builder');
const EOS = '0123456789abcdef0123456789abcdef';
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
assert.strictEqual(reviewed.length, 102, 'Reviewed official candidate count changed.');
assert.strictEqual(enriched.length, reviewed.length, 'Not every reviewed candidate has an enriched record.');
const terms = new Map();
for (const creature of catalog) {
  for (const term of [creature.id, creature.name, ...(creature.aliases || [])]) terms.set(normalize(term), creature);
}
const missing = reviewed.filter(record => !terms.has(normalize(record.name)));
assert.deepStrictEqual(missing.map(x => x.name), [], 'Reviewed official creatures are missing from the catalog.');
for (const record of enriched) {
  const creature = terms.get(normalize(record.name));
  assert(creature, record.name + ' missing');
  assert(creature.blueprint.startsWith('/'), record.name + ' lacks a path-only blueprint');
  assert(!creature.blueprint.endsWith('_C'), record.name + ' blueprint has a class suffix');
  assert(['pair', 'single', 'single-random', 'unsupported'].includes(creature.deliveryMode), record.name + ' missing delivery mode');
  if (creature.deliveryMode !== 'unsupported') {
    const commands = buildFulfillmentCommands(creature, EOS);
    assert.strictEqual(commands.length, creature.deliveryMode === 'pair' ? 2 : 1, record.name + ' command count mismatch');
  }
}
console.log('Official ASA catalog coverage passed for ' + reviewed.length + ' reviewed candidates and ' + catalog.length + ' total catalog entries.');
