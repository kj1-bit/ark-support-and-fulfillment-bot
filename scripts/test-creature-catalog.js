const {
  getCreatureById,
  getEnabledCreatures,
  searchCreatures,
  validateCatalog
} = require('../services/creature-catalog');
const { buildFulfillmentCommands } = require('../services/aat-command-builder');

const EOS = '0123456789abcdef0123456789abcdef';
validateCatalog();

const enabled = getEnabledCreatures();
if (enabled.some(creature => creature.enabled !== true || creature.tameable !== true)) {
  throw new Error('Enabled catalog contains an invalid creature.');
}
if (searchCreatures('argy')[0]?.id !== 'argentavis') throw new Error('Argy alias search failed.');
if (searchCreatures('snail')[0]?.id !== 'achatina') throw new Error('Snail alias search failed.');
if (searchCreatures('disabled').length !== 0) throw new Error('Disabled creature leaked into search.');

const tekRex = getCreatureById('tek-rex');
const achatina = getCreatureById('achatina');
if (buildFulfillmentCommands(tekRex, EOS).length !== 2) throw new Error('Tek Rex should produce a pair.');
if (buildFulfillmentCommands(achatina, EOS).length !== 1) throw new Error('Achatina should produce one genderless cryo.');

console.table(enabled.map(c => ({ id: c.id, name: c.name, gendered: c.supportsGender, saddle: c.saddleApplicable })));
console.log('Creature catalog test passed.');
