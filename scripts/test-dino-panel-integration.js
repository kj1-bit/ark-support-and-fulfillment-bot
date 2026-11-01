const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  panelPayload,
  reviewPayload
} = require('../features/dino-fulfillment-panel');

const indexText = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
assert(indexText.includes("require('./features/dino-fulfillment-panel')"));
assert(indexText.includes('dinoFulfillment.initializeDatabase()'));
assert(indexText.includes('dinoFulfillment.refreshPanel()'));
assert(indexText.includes('dinoFulfillment.handleInteraction(interaction)'));

const panel = panelPayload();
assert.strictEqual(panel.components.length, 1);
assert.strictEqual(panel.components[0].components[0].data.custom_id, 'dino_browse');
assert.strictEqual(panel.components[0].components[1].data.custom_id, 'dino_search');

const review = reviewPayload({
  id: 'tek-rex', name: 'Tek Rex', blueprint: '/Game/PrimalEarth/Dinos/Rex/BionicRex_Character_BP.BionicRex_Character_BP',
  tameable: true, supportsGender: true, saddleApplicable: true, sourceMod: 'Vanilla', enabled: true
}, {
  characterName: 'Mock Player', serverName: 'The Island'
});
assert.strictEqual(review.components[0].components[0].data.custom_id, 'dino_confirm');
console.log('Dino panel integration test passed.');
