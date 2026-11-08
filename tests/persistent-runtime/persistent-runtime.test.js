'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFulfillmentService } = require('../../src/application/fulfillment-service');
const { createInMemoryFulfillmentRepository } = require('../../src/domain/fulfillment/in-memory-repository');
const { STATES } = require('../../src/domain/fulfillment/state-machine');

function baseOptions(overrides = {}) {
  return {
    authorization: { authorize: () => ({ allowed: true }) },
    interactionGuard: { consume: async () => ({ requestId: 'FUL-00000000-0000-4000-8000-000000000001' }) },
    repository: createInMemoryFulfillmentRepository(),
    creatures: { version: '1', get: () => ({ id: 'rex' }) },
    ark: { fulfillApprovedCreature: async () => [{ success: true }] },
    onlinePlayers: { revalidate: async () => ({ online: true }) },
    audit: { write: () => {} },
    clock: () => 1,
    uuid: () => '00000000-0000-4000-8000-000000000001',
    ...overrides
  };
}

const context = {
  actorId: '10000000000000001', guildId: '10000000000000002',
  channelId: '10000000000000003', messageId: '10000000000000004'
};

test('fulfillment awaits session consumption and player revalidation before execution', async () => {
  const order = [];
  const repository = createInMemoryFulfillmentRepository();
  const pendingId = 'FUL-00000000-0000-4000-8000-000000000001';
  const service = createFulfillmentService(baseOptions({
    repository,
    interactionGuard: { consume: async () => { order.push('consume'); return { requestId: pendingId }; } },
    onlinePlayers: { revalidate: async () => { order.push('revalidate'); return { online: true }; } },
    ark: { fulfillApprovedCreature: async () => { order.push('rcon'); return [{ success: true }]; } }
  }));
  const pending = await service.createPending({
    context, creatureId: 'rex', serverId: 'map', playerRef: 'player-ref-1',
    playerName: 'Target', eosId: 'a'.repeat(32), idempotencyKey: 'key', ttlMs: 100
  });
  await service.confirm({ token: 't', requestId: pending.id, context });
  assert.deepEqual(order, ['consume', 'revalidate', 'rcon']);
});

test('offline player fails before RCON and records a terminal failure', async () => {
  let rconCalls = 0;
  const repository = createInMemoryFulfillmentRepository();
  const service = createFulfillmentService(baseOptions({
    repository,
    onlinePlayers: { revalidate: async () => ({ online: false }) },
    ark: { fulfillApprovedCreature: async () => { rconCalls += 1; return [{ success: true }]; } }
  }));
  const pending = await service.createPending({
    context, creatureId: 'rex', serverId: 'map', playerRef: 'player-ref-1',
    playerName: 'Target', eosId: 'a'.repeat(32), idempotencyKey: 'offline-key', ttlMs: 100
  });
  await assert.rejects(
    () => service.confirm({ token: 't', requestId: pending.id, context }),
    /no longer online/
  );
  assert.equal(rconCalls, 0);
  assert.equal(repository.get(pending.id).state, STATES.FAILED);
});
