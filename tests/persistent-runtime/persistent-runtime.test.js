'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFulfillmentService } = require('../../src/application/fulfillment-service');
const { createInMemoryFulfillmentRepository } = require('../../src/domain/fulfillment/in-memory-repository');
const { STATES } = require('../../src/domain/fulfillment/state-machine');

const context = {
  actorId: '10000000000000001',
  guildId: '10000000000000002',
  channelId: '10000000000000003',
  messageId: '10000000000000004'
};

function baseOptions(overrides = {}) {
  let activeCatalog = { version: '1', get: id => ({ id, version: '1' }) };
  return {
    authorization: { authorize: () => ({ allowed: true }) },
    interactionGuard: { consume: async () => ({ requestId: 'FUL-00000000-0000-4000-8000-000000000001' }) },
    repository: createInMemoryFulfillmentRepository(),
    catalogManager: { current: () => activeCatalog },
    setCatalog(catalog) { activeCatalog = catalog; },
    ark: { fulfillApprovedCreature: async () => [{ success: true }] },
    onlinePlayers: { revalidate: async () => ({ online: true }) },
    audit: { write: () => {} },
    clock: () => 1,
    uuid: () => '00000000-0000-4000-8000-000000000001',
    ...overrides
  };
}

async function createPending(service, key = 'key') {
  return service.createPending({
    context,
    creatureId: 'rex',
    serverId: 'map',
    playerRef: 'player-ref-1',
    playerName: 'Target',
    eosId: 'a'.repeat(32),
    idempotencyKey: key,
    ttlMs: 100
  });
}

test('fulfillment awaits session consumption and player revalidation before execution', async () => {
  const order = [];
  const repository = createInMemoryFulfillmentRepository();
  const pendingId = 'FUL-00000000-0000-4000-8000-000000000001';
  const options = baseOptions({
    repository,
    interactionGuard: { consume: async () => { order.push('consume'); return { requestId: pendingId }; } },
    onlinePlayers: { revalidate: async () => { order.push('revalidate'); return { online: true }; } },
    ark: { fulfillApprovedCreature: async () => { order.push('rcon'); return [{ success: true }]; } }
  });
  const service = createFulfillmentService(options);
  const pending = await createPending(service);
  await service.confirm({ token: 't', requestId: pending.id, context });
  assert.deepEqual(order, ['consume', 'revalidate', 'rcon']);
});

test('fulfillment reads the active catalog and expires a request before claim when its version changes', async () => {
  const options = baseOptions();
  const repository = options.repository;
  const service = createFulfillmentService(options);
  const pending = await createPending(service);
  options.setCatalog({ version: '2', get: id => ({ id, version: '2' }) });

  await assert.rejects(() => service.confirm({ token: 't', context }), /Catalog version changed/);
  assert.equal(repository.get(pending.id).state, STATES.EXPIRED);
  assert.equal(repository.get(pending.id).claimedAt, undefined);
});

test('new fulfillment uses the catalog activated after service construction', async () => {
  const options = baseOptions();
  options.setCatalog({ version: '2', get: id => ({ id, version: '2' }) });
  let delivered;
  const service = createFulfillmentService({
    ...options,
    ark: { fulfillApprovedCreature: async input => { delivered = input.creature; return [{ success: true }]; } }
  });
  const pending = await createPending(service, 'activated-catalog');
  await service.confirm({ token: 't', context });
  assert.equal(pending.catalogVersion, '2');
  assert.equal(delivered.version, '2');
});

test('a later RCON failure preserves prior successful operation results as uncertain', async () => {
  const repository = createInMemoryFulfillmentRepository();
  const options = baseOptions({
    repository,
    ark: {
      fulfillApprovedCreature: async ({ onResult }) => {
        await onResult({ success: true });
        throw new Error('second operation timed out');
      }
    }
  });
  const service = createFulfillmentService(options);
  const pending = await createPending(service, 'partial-result');
  await assert.rejects(() => service.confirm({ token: 't', context }), /second operation timed out/);
  assert.equal(repository.get(pending.id).state, STATES.UNCERTAIN);
  assert.deepEqual(repository.get(pending.id).results, [{ success: true }]);
});

test('cancel consumes the same confirmation session and persistently cancels the request', async () => {
  let consumed = false;
  const repository = createInMemoryFulfillmentRepository();
  const options = baseOptions({
    repository,
    interactionGuard: {
      consume: async () => {
        if (consumed) throw new Error('session already consumed');
        consumed = true;
        return { requestId: 'FUL-00000000-0000-4000-8000-000000000001' };
      }
    }
  });
  const service = createFulfillmentService(options);
  const pending = await createPending(service, 'cancel');
  const canceled = await service.cancel({ token: 't', context });
  assert.equal(canceled.state, STATES.CANCELED);
  await assert.rejects(() => service.confirm({ token: 't', context }), /session already consumed/);
  assert.equal(repository.get(pending.id).state, STATES.CANCELED);
});

test('offline player fails before RCON and records a terminal failure', async () => {
  let rconCalls = 0;
  const repository = createInMemoryFulfillmentRepository();
  const service = createFulfillmentService(baseOptions({
    repository,
    onlinePlayers: { revalidate: async () => ({ online: false }) },
    ark: { fulfillApprovedCreature: async () => { rconCalls += 1; return [{ success: true }]; } }
  }));
  const pending = await createPending(service, 'offline-key');
  await assert.rejects(() => service.confirm({ token: 't', context }), /no longer online/);
  assert.equal(rconCalls, 0);
  assert.equal(repository.get(pending.id).state, STATES.FAILED);
});
