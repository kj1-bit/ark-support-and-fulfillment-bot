const {
  buildFulfillmentCommands,
  buildFulfillmentSummary
} = require('../services/aat-command-builder');

const TEST_EOS_ID = '0123456789abcdef0123456789abcdef';

const tekRex = {
  id: 'tek-rex',
  name: 'Tek Rex',
  blueprint: '/Game/PrimalEarth/Dinos/Rex/BionicRex_Character_BP.BionicRex_Character_BP',
  tameable: true,
  supportsGender: true,
  saddleApplicable: true,
  enabled: true
};

const commands = buildFulfillmentCommands(tekRex, TEST_EOS_ID);

console.log('Fulfillment summary:');
console.table([buildFulfillmentSummary(tekRex)]);
console.log('\nGenerated commands:');

for (const item of commands) {
  console.log(`\n${item.label}:`);
  console.log(item.command);
}

if (commands.length !== 2) throw new Error('Tek Rex should generate exactly two commands.');
if (!commands[0].command.includes('-Gender=1')) throw new Error('Male command is missing Gender=1.');
if (!commands[1].command.includes('-Gender=2')) throw new Error('Female command is missing Gender=2.');
if (!commands.every(item => item.command.includes('-Level=450'))) throw new Error('Every command must use level 450.');
if (!commands.every(item => item.command.includes('-SaddleQuality=10.0'))) {
  throw new Error('Every saddled command must use saddle quality 10.0.');
}

console.log('\nAAT command-builder test passed.');
