const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildFulfillmentCommands,
  buildFulfillmentSummary
} = require('../services/aat-command-builder');
const { maskEosId } = require('../features/dino-fulfillment-panel');

const root = path.resolve(__dirname, '..');
const panelSource = fs.readFileSync(
  path.join(root, 'features', 'dino-fulfillment-panel.js'),
  'utf8'
);

const creature = {
  id: 'tek-rex',
  name: 'Tek Rex',
  blueprint: '/Game/PrimalEarth/Dinos/Rex/BionicRex_Character_BP.BionicRex_Character_BP',
  tameable: true,
  supportsGender: true,
  saddleApplicable: true,
  enabled: true
};
const eosId = '0123456789abcdef0123456789abcdef';
const commands = buildFulfillmentCommands(creature, eosId);
assert(commands.every(item => item.command.includes('-ImprintPercentage=1.0')));
assert(commands.every(item => !item.command.includes('-ImprintPercentage=100.0')));
assert.strictEqual(buildFulfillmentSummary(creature).imprintPercentage, 100);
assert.strictEqual(maskEosId(eosId), '012345...abcdef');
assert(panelSource.includes('Scanning all configured maps for online players. This may take a few seconds...'));
assert(panelSource.includes('DINO_FULFILLMENT_LOG_CHANNEL_ID'));

assert(!panelSource.includes(eosId));

console.log('Dino imprint and logging hotfix test passed.');
