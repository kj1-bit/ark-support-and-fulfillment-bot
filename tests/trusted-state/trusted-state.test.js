'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionStore } = require('../../src/domain/sessions/session-store');
const { createPlayerRegistry } = require('../../src/registries/player-registry');
const { createCatalogManager } = require('../../src/catalog/catalog-manager');

function plainCatalog(registry) {
  return {
    version: registry.version,
    creatures: registry.creatures
  };
}

function createCatalogStore(initialCatalog) {
  let active = initialCatalog;
  const retained = [];

  return {
    async activate(registry) {
      if (active) retained.unshift(active);
      active = plainCatalog(registry);
      return active;
    },

    async loadActive() {
      return active;
    },

    async previousActive(currentVersion) {
      return retained.find(item => item.version !== currentVersion) || null;
    }
  };
}

test('persistent session issue and consume delegate server-side state', async () => {
  let saved;
  const store = createSessionStore({
    clock: () => 10,
    uuid: () => 'token',
    repository: {
      create: async record => (saved = record),
      consume: async (token, context, now) => ({ token, context, now })
    }
  });

  const issued = await store.issue({
    feature: 'fulfillment',
    actorId: '10000000000000001',
    guildId: '10000000000000002',
    channelId: '10000000000000003',
    messageId: '10000000000000004',
    action: 'confirm',
    requestId: 'r',
    ttlMs: 100
  });

  assert.equal(issued.expiresAt, 110);
  assert.deepEqual(await store.consume('token', { actorId: 'x' }), {
    token: 'token',
    context: { actorId: 'x' },
    now: 10
  });
  assert.equal(saved.state, 'ACTIVE');
});

test('trusted player registry rejects unverified and duplicate identities', () => {
  const good = {
    discordId: '10000000000000001',
    eosId: '0123456789abcdef0123456789abcdef',
    verified: true,
    displayName: 'Player'
  };

  assert.throws(
    () => createPlayerRegistry([{ ...good, verified: false }]),
    /Unverified/
  );
  assert.throws(
    () => createPlayerRegistry([good, { ...good, discordId: '10000000000000002' }]),
    /Duplicate/
  );
  assert.equal(createPlayerRegistry([good]).byDiscord(good.discordId).displayName, 'Player');
});

const creature = {
  id: 'rex',
  name: 'Rex',
  aliases: [],
  blueprint: '/Game/Rex.Rex',
  enabled: true,
  tameable: true,
  deliveryMode: 'pair',
  supportsGender: true,
  saddleApplicable: true
};

test('catalog activation is validated, durable, auditable, and reversible', async () => {
  const events = [];
  const initialCatalog = { version: '2026.1.0', creatures: [creature] };
  const store = createCatalogStore(initialCatalog);
  const manager = createCatalogManager({
    initialCatalog,
    store,
    audit: { write: (type, details) => events.push([type, details]) }
  });

  const proposal = await manager.propose({
    version: '2026.2.0',
    creatures: [{ ...creature, name: 'Rex Prime' }]
  });

  assert.deepEqual(proposal.changes.changed, ['rex']);
  await manager.activate(proposal);
  assert.equal(manager.current().version, '2026.2.0');
  assert.equal((await store.loadActive()).version, '2026.2.0');

  await manager.rollback();
  assert.equal(manager.current().version, '2026.1.0');
  assert.equal((await store.loadActive()).version, '2026.1.0');
  assert.deepEqual(events.map(item => item[0]), [
    'catalog.activated',
    'catalog.rolled-back'
  ]);
});

test('invalid catalog proposal leaves active catalog unchanged', async () => {
  const initialCatalog = { version: '2026.1.0', creatures: [creature] };
  const store = createCatalogStore(initialCatalog);
  const manager = createCatalogManager({
    initialCatalog,
    store,
    audit: { write: () => {} }
  });

  await assert.rejects(
    () => manager.propose({
      version: '2026.2.0',
      creatures: [{ ...creature, blueprint: ';quit' }]
    }),
    /unsafe/
  );

  assert.equal(manager.current().version, '2026.1.0');
  assert.equal((await store.loadActive()).version, '2026.1.0');
});
