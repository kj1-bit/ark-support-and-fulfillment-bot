'use strict';

const assert = require('node:assert/strict');

function collectCustomIds(payload) {
  const ids = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const id = value.custom_id ?? value.customId;
    if (id !== undefined) ids.push(id);
    visit(value.components);
  };
  // JSON round-tripping serializes discord.js builders through their toJSON methods.
  visit(JSON.parse(JSON.stringify(payload)).components);
  return ids;
}

// Discord rejects a message whose components repeat a custom_id, even on disabled buttons (50035).
function assertUniqueCustomIds(payload, label = 'payload') {
  const ids = collectCustomIds(payload);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `${label} repeats custom_id values: ${duplicates.join(', ')}`);
  return ids;
}

module.exports = { assertUniqueCustomIds, collectCustomIds };
