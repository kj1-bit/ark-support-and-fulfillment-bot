'use strict';

const crypto = require('node:crypto');
const { requireIdentifier } = require('../contracts/identifiers');
const { STATES } = require('../domain/fulfillment/state-machine');

function createFulfillmentService({
  authorization,
  interactionGuard,
  repository,
  catalogManager,
  ark,
  onlinePlayers,
  audit,
  clock = Date.now,
  uuid = crypto.randomUUID
}) {
  for (const [name, object, method] of [
    ['authorization', authorization, 'authorize'],
    ['interactionGuard', interactionGuard, 'consume'],
    ['repository', repository, 'create'],
    ['repository', repository, 'get'],
    ['repository', repository, 'cancel'],
    ['repository', repository, 'updateResults'],
    ['catalogManager', catalogManager, 'current'],
    ['ark', ark, 'fulfillApprovedCreature'],
    ['onlinePlayers', onlinePlayers, 'revalidate'],
    ['audit', audit, 'write']
  ]) {
    if (!object || typeof object[method] !== 'function') {
      throw new TypeError(`${name}.${method} is required.`);
    }
  }

  function authorize(context) {
    return authorization.authorize('fulfillment.confirm', context);
  }

  return Object.freeze({
    async createPending(input) {
      authorize(input.context);
      const creatures = catalogManager.current();
      const creature = creatures.get(input.creatureId);
      requireIdentifier('serverId', input.serverId);
      requireIdentifier('eosId', input.eosId);
      if (typeof input.playerRef !== 'string' || input.playerRef.length < 8) {
        throw new TypeError('Trusted playerRef is required.');
      }
      const now = clock();
      const record = await repository.create(Object.freeze({
        id: `FUL-${uuid()}`,
        idempotencyKey: input.idempotencyKey,
        actorId: input.context.actorId,
        guildId: input.context.guildId,
        channelId: input.context.channelId,
        messageId: input.context.messageId,
        creatureId: creature.id,
        catalogVersion: creatures.version,
        serverId: input.serverId,
        playerRef: input.playerRef,
        playerName: input.playerName,
        eosId: input.eosId,
        state: STATES.PENDING,
        createdAt: now,
        expiresAt: now + input.ttlMs
      }));
      audit.write('fulfillment.pending', record);
      return record;
    },

    async confirm(input) {
      const decision = authorize(input.context);
      const session = await interactionGuard.consume(input.token, {
        ...input.context,
        action: 'fulfillment.confirm'
      });
      if (!session?.requestId) {
        throw new Error('The confirmation session is missing its request binding.');
      }
      const creatures = catalogManager.current();
      const pending = await repository.get(session.requestId);
      if (!pending || pending.actorId !== input.context.actorId) {
        throw new Error('Fulfillment request cannot be claimed.');
      }
      if (pending.catalogVersion !== creatures.version) {
        const expired = await repository.update(pending.id, STATES.EXPIRED, { completedAt: clock() });
        audit.write('fulfillment.expired', { requestId: expired.id, reason: 'CATALOG_VERSION_CHANGED' });
        throw new Error('Catalog version changed before fulfillment.');
      }
      const claimed = await repository.claim(session.requestId, input.context.actorId, clock());

      const availability = await onlinePlayers.revalidate({
        playerRef: claimed.playerRef,
        serverId: claimed.serverId,
        eosId: claimed.eosId
      });
      if (!availability.online) {
        const failed = await repository.update(claimed.id, STATES.FAILED, {
          completedAt: clock(),
          results: [{ success: false, reason: 'PLAYER_OFFLINE' }]
        });
        audit.write('fulfillment.completed', failed);
        throw new Error('The selected player is no longer online.');
      }

      await repository.update(claimed.id, STATES.EXECUTING);
      try {
        const operationResults = [];
        const results = await ark.fulfillApprovedCreature({
          requestId: claimed.id,
          serverId: claimed.serverId,
          creature: creatures.get(claimed.creatureId),
          eosId: claimed.eosId,
          onResult: async result => {
            operationResults.push(result);
            await repository.updateResults(claimed.id, operationResults);
          }
        });
        if (!Array.isArray(results) || results.length === 0) {
          throw new Error('Fulfillment returned no operation results.');
        }
        const successes = results.filter(result => result?.success).length;
        const state = successes === results.length
          ? STATES.SUCCEEDED
          : successes
            ? STATES.PARTIAL
            : STATES.FAILED;
        const done = await repository.update(claimed.id, state, {
          results,
          completedAt: clock(),
          authorization: decision
        });
        audit.write('fulfillment.completed', done);
        return done;
      } catch (error) {
        const current = await repository.get(claimed.id);
        await repository.update(claimed.id, STATES.UNCERTAIN, {
          completedAt: clock(),
          results: current?.results
        });
        audit.write('fulfillment.uncertain', { requestId: claimed.id, error });
        throw error;
      }
    },

    async cancel(input) {
      authorize(input.context);
      const session = await interactionGuard.consume(input.token, {
        ...input.context,
        action: 'fulfillment.confirm'
      });
      if (!session?.requestId) {
        throw new Error('The confirmation session is missing its request binding.');
      }
      const canceled = await repository.cancel(session.requestId, input.context.actorId, clock());
      audit.write('fulfillment.canceled', { requestId: canceled.id, state: canceled.state });
      return canceled;
    }
  });
}

module.exports = { createFulfillmentService };
