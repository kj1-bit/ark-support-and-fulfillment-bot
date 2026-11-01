const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getCatalogPage, getCreatureById, searchCreatures } = require('../services/creature-catalog');
const { catalogPagePayload, reviewPayload } = require('../features/dino-fulfillment-panel');

const pyromane = getCreatureById('pyromane');
assert(pyromane, 'Pyromane must be enabled.');
assert.strictEqual(pyromane.requiresDlc, true);
assert.strictEqual(pyromane.dlcName, 'ARK Fantastic Tames - Pyromane');
assert.strictEqual(pyromane.blueprint, '/Game/ASA/Dinos/FireLion/FireLion_Character_BP.FireLion_Character_BP');
assert.strictEqual(searchCreatures('pyro')[0]?.id, 'pyromane');
assert.strictEqual(searchCreatures('fire lion')[0]?.id, 'pyromane');

const first = getCatalogPage(0, 25);
const last = getCatalogPage(999, 25);
assert(first.creatures.length > 0 && first.creatures.length <= 25);
assert(last.page === last.pageCount - 1);
assert(first.total >= 92);
assert(first.creatures.every((c, i, list) => i === 0 || list[i - 1].name.localeCompare(c.name) <= 0));

const payload = catalogPagePayload(0);
assert.strictEqual(payload.components.length, 2);
assert(payload.content.includes('Dino Catalog'));

const review = reviewPayload(pyromane, { characterName: 'Test Player', serverName: 'Test Map' });
const json = JSON.stringify(review.embeds[0].toJSON());
assert(json.includes('DLC ownership warning'));
assert(json.includes('ARK Fantastic Tames - Pyromane'));

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
assert(indexSource.includes('DLC creature requests'));
assert(indexSource.includes('Delivery does not guarantee access'));
console.log('Dino catalog browser and DLC test passed.');
