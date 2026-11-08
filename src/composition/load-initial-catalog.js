'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function loadInitialCatalog(catalogPath) {
  const source = fs.readFileSync(catalogPath || path.resolve(__dirname, '../../data/dino-catalog.json'));
  const entries = JSON.parse(source.toString('utf8'));
  if (!Array.isArray(entries)) throw new TypeError('The V2 catalog source must be a JSON array.');

  const creatures = entries.filter(creature => creature.enabled === true && creature.tameable === true);
  const digest = crypto.createHash('sha256').update(source).digest('hex');
  return Object.freeze({
    version: `2026.1.0-${digest.slice(0, 16)}`,
    creatures: Object.freeze(creatures)
  });
}

module.exports = { loadInitialCatalog };
