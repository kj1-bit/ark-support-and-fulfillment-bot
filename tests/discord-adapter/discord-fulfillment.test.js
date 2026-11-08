'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFulfillmentController, maskEosId } = require('../../src/adapters/discord/fulfillment-controller');
const { createOnlinePlayerSelectionService } = require('../../src/application/online-player-selection-service');
const { safeInteractionMessage } = require('../../src/adapters/discord/safe-response');

function interaction(actorId = '10000000000000001') {
  return {
    user: { id: actorId },
    guildId: '10000000000000002',
    channelId: '10000000000000003',
    message: { id: '10000000000000004' },
    member: { roleIds: ['10000000000000005'] }
  };
}

function selectionService() {
  const eosId = 'a'.repeat(32);
  const players = {
    byEos: value => value === eosId
      ? { discordId: '10000000000000009', displayName: 'Target Player', eosId, verified: true }
      : null
  };
  const ark = { listOnlinePlayers: async () => [{ eosId, name: 'Target Player' }] };
  let counter = 0;
  return createOnlinePlayerSelectionService({
    players,
    ark,
    clock: () => 10,
    uuid: () => `player-ref-${++counter}`
  });
}

test('moderator selects a different trusted online player using an opaque playerRef', async () => {
  const calls = [];
  const onlinePlayers = selectionService();
  const actor = interaction();
  const options = await onlinePlayers.scan({
    context: { actorId: actor.user.id, guildId: actor.guildId, channelId: actor.channelId },
    serverId: 'map-one',
    ttlMs: 100
  });
  const controller = createFulfillmentController({
    services: {
      authorization: { authorize: () => calls.push('authorize') },
      onlinePlayers,
      catalogManager: { current: () => ({ version: '2026.1.0', get: () => ({ id: 'rex', name: 'Rex' }) }) },
      fulfillment: { createPending: async value => { calls.push(value); return { id: 'FUL-1' }; } },
      interactionGuard: { issue: async () => ({ token: 'opaque', expiresAt: 100 }) }
    }
  });
  const result = await controller.begin(actor, {
    playerRef: options[0].playerRef,
    creatureId: 'rex', serverId: 'map-one', idempotencyKey: 'key', ttlMs: 100
  });
  const pending = calls.find(value => typeof value === 'object');
  assert.equal(result.playerName, 'Target Player');
  assert.equal(pending.eosId, 'a'.repeat(32));
  assert.equal(pending.playerRef, options[0].playerRef);
  assert.notEqual(pending.eosId, actor.user.id);
});

test('playerRef is bound to moderator guild and channel', async () => {
  const service = selectionService();
  const context = { actorId: '10000000000000001', guildId: '10000000000000002', channelId: '10000000000000003' };
  const options = await service.scan({ context, serverId: 'map-one', ttlMs: 100 });
  assert.throws(
    () => service.resolve(options[0].playerRef, { ...context, actorId: '10000000000000008' }),
    /not valid/
  );
});

test('confirm requires a message-bound component context', async () => {
  const controller = createFulfillmentController({
    services: {
      authorization: {}, interactionGuard: {}, onlinePlayers: {}, catalogManager: {},
      fulfillment: { confirm: async value => value }
    }
  });
  const noMessage = interaction();
  delete noMessage.message;
  await assert.rejects(() => controller.confirm(noMessage, { token: 't', requestId: 'r' }), /message-bound/);
});

test('moderator log masks EOS ID and safe errors expose no internals', () => {
  const controller = createFulfillmentController({
    clock: () => 0,
    services: { authorization: {}, interactionGuard: {}, onlinePlayers: {}, catalogManager: {}, fulfillment: {} }
  });
  const log = controller.moderatorLog(
    { id: 'r', state: 'SUCCEEDED' },
    { moderatorId: 'm', creatureName: 'Rex', playerName: 'P', serverId: 'map', eosId: '0123456789abcdef0123456789abcdef' }
  );
  assert.equal(log.eosId, '0123…cdef');
  assert(!JSON.stringify(log).includes('0123456789abcdef0123456789abcdef'));
  assert.match(safeInteractionMessage(new Error('already consumed token database detail')), /no longer valid/);
});

test('mask function fails closed for malformed identifiers', () => {
  assert.equal(maskEosId('bad'), '[masked]');
});
