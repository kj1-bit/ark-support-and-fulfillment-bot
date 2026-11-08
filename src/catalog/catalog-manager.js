'use strict';

const {
  createCreatureRegistry,
  diffCatalogs
} = require('../registries/creature-registry');

function createCatalogManager({ initialCatalog, store, audit }) {
  if (
    !store ||
    typeof store.activate !== 'function' ||
    typeof store.loadActive !== 'function' ||
    typeof store.previousActive !== 'function'
  ) {
    throw new TypeError('catalog store activation interface is required.');
  }
  if (!audit || typeof audit.write !== 'function') {
    throw new TypeError('audit.write is required.');
  }

  let active = createCreatureRegistry(initialCatalog);

  return Object.freeze({
    current() {
      return active;
    },

    async propose(catalog) {
      const proposed = createCreatureRegistry(catalog);
      return Object.freeze({
        registry: proposed,
        changes: diffCatalogs(active, proposed)
      });
    },

    async activate(proposal) {
      if (!proposal?.registry) {
        throw new TypeError('Validated catalog proposal is required.');
      }

      const previousVersion = active.version;
      const persisted = await store.activate(proposal.registry);
      const activated = createCreatureRegistry(persisted);

      active = activated;
      audit.write('catalog.activated', {
        version: active.version,
        previousVersion,
        changes: proposal.changes
      });
      return active;
    },

    async rollback() {
      const previous = await store.previousActive(active.version);
      if (!previous) {
        throw new Error('No previous catalog is available.');
      }

      const replacedVersion = active.version;
      const target = createCreatureRegistry(previous);
      const persisted = await store.activate(target);
      const activated = createCreatureRegistry(persisted);

      active = activated;
      audit.write('catalog.rolled-back', {
        version: active.version,
        replacedVersion
      });
      return active;
    }
  });
}

module.exports = { createCatalogManager };
