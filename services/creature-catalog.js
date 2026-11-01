const creatures = require('../data/dino-catalog.json');
const { validateCreature } = require('./aat-command-builder');

function normalizeSearchText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchableText(creature) {
  return normalizeSearchText([
    creature.name,
    ...(creature.aliases || []),
    creature.blueprint,
    creature.sourceMod,
    creature.dlcName
  ].filter(Boolean).join(' '));
}

function getEnabledCreatures() {
  return creatures.filter(creature =>
    creature.enabled === true && creature.tameable === true
  );
}

function getCatalogPage(page = 0, pageSize = 25) {
  const creatures = getEnabledCreatures()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const size = Math.max(1, Math.min(Number(pageSize) || 25, 25));
  const pageCount = Math.max(1, Math.ceil(creatures.length / size));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), pageCount - 1);
  return {
    creatures: creatures.slice(safePage * size, (safePage + 1) * size),
    page: safePage,
    pageCount,
    total: creatures.length
  };
}

function getCreatureById(id) {
  const normalizedId = normalizeSearchText(id).replace(/ /g, '-');
  return getEnabledCreatures().find(creature => creature.id === normalizedId) || null;
}

function searchCreatures(query, limit = 25) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const terms = normalized.split(' ').filter(Boolean);
  return getEnabledCreatures()
    .map(creature => {
      const name = normalizeSearchText(creature.name);
      const aliases = (creature.aliases || []).map(normalizeSearchText);
      const haystack = searchableText(creature);
      if (!terms.every(term => haystack.includes(term))) return null;

      let score = 3;
      if (name === normalized) score = 0;
      else if (aliases.includes(normalized)) score = 1;
      else if (name.startsWith(normalized)) score = 2;
      return { creature, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.creature.name.localeCompare(b.creature.name))
    .slice(0, Math.max(1, Math.min(Number(limit) || 25, 25)))
    .map(result => result.creature);
}

function validateCatalog() {
  const ids = new Set();
  for (const creature of creatures) {
    if (ids.has(creature.id)) throw new Error(`Duplicate creature ID: ${creature.id}`);
    ids.add(creature.id);
    if (creature.enabled) validateCreature(creature);
  }
  return true;
}

module.exports = {
  getCatalogPage,
  getCreatureById,
  getEnabledCreatures,
  normalizeSearchText,
  searchCreatures,
  validateCatalog
};
