'use strict';

const { toInteractionContext } = require('./interaction-context');
function maskEosId(value) {
  const text = String(value || '');
  return text.length === 32 ? `${text.slice(0, 4)}…${text.slice(-4)}` : '[masked]';
}
function createFulfillmentController({ services, clock = Date.now }) {
  if (!services?.authorization || !services?.interactionGuard || !services?.fulfillment
    || !services?.onlinePlayers || !services?.catalogManager) {
    throw new TypeError('Trusted fulfillment services are required.');
  }
  return Object.freeze({
    authorize(interaction, capability = 'fulfillment.confirm') {
      return services.authorization.authorize(capability, toInteractionContext(interaction));
    },
    catalog() { return services.catalogManager.current(); },
    search(input) { return services.shop.search(input); },
    async verify(interaction, input) {
      const context = toInteractionContext(interaction, { requireMessage: true });
      services.authorization.authorize('player-names.verify', context);
      return services.playerNames.verify({ discordId: input.discordId, moderatorId: context.actorId, context });
    },
    async scan(interaction, input) {
      const context = toInteractionContext(interaction);
      services.authorization.authorize('fulfillment.confirm', context);
      return services.onlinePlayers.scan({ context, serverId: input.serverId, ttlMs: input.ttlMs });
    },
    async scanCandidates(interaction, input) {
      const context = toInteractionContext(interaction);
      services.authorization.authorize('player-names.verify', context);
      return services.onlinePlayers.scan({ context, serverId: input.serverId, ttlMs: input.ttlMs, includeUntrusted: true });
    },
    async scanPage(interaction, input) {
      const context = toInteractionContext(interaction);
      services.authorization.authorize(input.linking ? 'player-names.verify' : 'fulfillment.confirm', context);
      return services.onlinePlayers.scanPage({ context, serverId: input.serverId, ttlMs: input.ttlMs,
        serverIds: input.serverIds,
        remembered: input.linking === true,
        includeUntrusted: input.linking === true, page: input.page || 1 });
    },
    assertUnlinked(interaction, discordId) {
      services.authorization.authorize('player-names.verify', toInteractionContext(interaction, { requireMessage: true }));
      services.playerLinks.assertUnlinked(discordId);
    },
    linkedPlayer(interaction, discordId) {
      services.authorization.authorize('player-names.verify', toInteractionContext(interaction, { requireMessage: true }));
      const record = services.playerLinks.get(discordId);
      if (!record) throw Object.assign(new Error('This Discord member has no linked in-game identity.'), { code: 'PLAYER_NOT_LINKED' });
      return record;
    },
    async unlink(interaction, input) {
      const context = toInteractionContext(interaction, { requireMessage: true });
      services.authorization.authorize('player-names.verify', context);
      return services.playerLinks.unlink({ ...input, actorId: context.actorId });
    },
    async associateManual(interaction, input) {
      const context = toInteractionContext(interaction, { requireMessage: true });
      services.authorization.authorize('player-names.verify', context);
      return services.playerLinks.link({ ...input, actorId: context.actorId, source: 'manual', manual: true });
    },
    async associate(interaction, input) {
      if (!services.playerLinks) {
        throw new TypeError('Trusted identity persistence services are required.');
      }
      const context = toInteractionContext(interaction, { requireMessage: true });
      services.authorization.authorize('player-names.verify', context);
      const observed = services.onlinePlayers.resolve(input.playerRef, context, { allowUntrusted: true });
      const record = await services.playerLinks.link({ discordId: input.discordId, eosId: observed.eosId,
        displayName: observed.displayName, source: `observed:${observed.serverId}`, actorId: context.actorId });
      services.onlinePlayers.consume?.(input.playerRef);
      return record;
    },
    async begin(interaction, input) {
      const context = toInteractionContext(interaction, { requireMessage: true });
      services.authorization.authorize('fulfillment.confirm', context);
      const player = services.onlinePlayers.resolve(input.playerRef, context);
      if (!player.trusted) throw new Error('Only verified player identities may receive fulfillment.');
      if (player.serverId !== input.serverId) throw new Error('The selected player and server do not match.');
      const catalog = services.catalogManager.current();
      if (input.catalogVersion && input.catalogVersion !== catalog.version) {
        throw new Error('Catalog version changed. Start a new catalog selection.');
      }
      const creature = catalog.get(input.creatureId);
      const request = await services.fulfillment.createPending({
        context, creatureId: creature.id, serverId: player.serverId, playerRef: player.playerRef,
        eosId: player.eosId, playerName: player.displayName, idempotencyKey: input.idempotencyKey, ttlMs: input.ttlMs
      });
      const session = await services.interactionGuard.issue({
        feature: 'fulfillment', actorId: context.actorId, guildId: context.guildId, channelId: context.channelId,
        messageId: context.messageId, action: 'fulfillment.confirm', requestId: request.id, ttlMs: input.ttlMs
      });
      return Object.freeze({ requestId: request.id, token: session.token, expiresAt: session.expiresAt,
        playerName: player.displayName, creatureName: creature.name, creatureId: creature.id,
        serverId: player.serverId, catalogVersion: catalog.version, notice: 'Review the verified target before fulfillment.' });
    },
    async confirm(interaction, input) {
      const context = toInteractionContext(interaction, { requireMessage: true });
      return services.fulfillment.confirm({ context, token: input.token });
    },
    async cancel(interaction, input) {
      const context = toInteractionContext(interaction, { requireMessage: true });
      return services.fulfillment.cancel({ context, token: input.token });
    },
    moderatorLog(result, details) {
      return Object.freeze({ requestId: result.id || details.requestId, moderatorId: details.moderatorId,
        creature: details.creatureName, targetPlayer: details.playerName, map: details.serverId,
        result: result.state, eosId: maskEosId(details.eosId), timestamp: new Date(clock()).toISOString() });
    }
  });
}
module.exports = { createFulfillmentController, maskEosId };
