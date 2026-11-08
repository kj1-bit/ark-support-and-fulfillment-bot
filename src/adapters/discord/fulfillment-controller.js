'use strict';

const { toInteractionContext } = require('./interaction-context');

function maskEosId(value) {
  const text = String(value || '');
  return text.length === 32 ? `${text.slice(0, 4)}…${text.slice(-4)}` : '[masked]';
}

function createFulfillmentController({ services, clock = Date.now }) {
  if (
    !services?.authorization ||
    !services?.interactionGuard ||
    !services?.fulfillment ||
    !services?.onlinePlayers ||
    !services?.catalogManager
  ) {
    throw new TypeError('Trusted fulfillment services are required.');
  }

  return Object.freeze({
    async scan(interaction, input) {
      const context = toInteractionContext(interaction);
      services.authorization.authorize('fulfillment.confirm', context);
      return services.onlinePlayers.scan({
        context,
        serverId: input.serverId,
        ttlMs: input.ttlMs
      });
    },

    async begin(interaction, input) {
      const context = toInteractionContext(interaction);
      services.authorization.authorize('fulfillment.confirm', context);
      const player = services.onlinePlayers.resolve(input.playerRef, context);
      if (player.serverId !== input.serverId) {
        throw new Error('The selected player and server do not match.');
      }

      const catalog = services.catalogManager.current();
      const creature = catalog.get(input.creatureId);
      const request = await services.fulfillment.createPending({
        context,
        creatureId: creature.id,
        serverId: player.serverId,
        playerRef: player.playerRef,
        eosId: player.eosId,
        playerName: player.displayName,
        idempotencyKey: input.idempotencyKey,
        ttlMs: input.ttlMs
      });
      const session = await services.interactionGuard.issue({
        feature: 'fulfillment',
        actorId: context.actorId,
        guildId: context.guildId,
        channelId: context.channelId,
        messageId: context.messageId,
        action: 'fulfillment.confirm',
        requestId: request.id,
        ttlMs: input.ttlMs
      });

      return Object.freeze({
        requestId: request.id,
        token: session.token,
        expiresAt: session.expiresAt,
        playerName: player.displayName,
        creatureName: creature.name,
        creatureId: creature.id,
        serverId: player.serverId,
        catalogVersion: catalog.version,
        notice: 'Online-player scanning may take a few seconds.'
      });
    },

    async confirm(interaction, input) {
      const context = toInteractionContext(interaction, { requireMessage: true });
      return services.fulfillment.confirm({
        context,
        token: input.token
      });
    },

    moderatorLog(result, details) {
      return Object.freeze({
        requestId: result.id || details.requestId,
        moderatorId: details.moderatorId,
        creature: details.creatureName,
        targetPlayer: details.playerName,
        map: details.serverId,
        result: result.state,
        eosId: maskEosId(details.eosId),
        timestamp: new Date(clock()).toISOString()
      });
    }
  });
}

module.exports = { createFulfillmentController, maskEosId };
