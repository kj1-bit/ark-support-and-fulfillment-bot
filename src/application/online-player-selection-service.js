'use strict';

const crypto = require('node:crypto');

const EOS_ID = /^[0-9a-f]{32}$/i;

function extractPlayers(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.players)) return result.players;
  return [];
}

function normalizeObservedPlayer(item) {
  const eosId = String(
    item?.eosId || item?.eos || item?.EOS || item?.uniqueNetId || ''
  ).toLowerCase();
  if (!EOS_ID.test(eosId)) return null;
  return Object.freeze({
    eosId,
    displayName: String(item?.displayName || item?.name || item?.playerName || '').slice(0, 64)
  });
}

function createOnlinePlayerSelectionService({
  players,
  ark,
  clock = Date.now,
  uuid = crypto.randomUUID
}) {
  if (!players || typeof players.byEos !== 'function') {
    throw new TypeError('trusted player registry is required.');
  }
  if (!ark || typeof ark.listOnlinePlayers !== 'function') {
    throw new TypeError('ark.listOnlinePlayers is required.');
  }

  const selections = new Map();

  async function observedTrustedPlayers(serverId) {
    const raw = await ark.listOnlinePlayers(serverId);
    return extractPlayers(raw)
      .map(normalizeObservedPlayer)
      .filter(Boolean)
      .map(observed => {
        const trusted = players.byEos(observed.eosId);
        return trusted
          ? Object.freeze({
              eosId: trusted.eosId,
              displayName: trusted.displayName,
              discordId: trusted.discordId,
              serverId
            })
          : null;
      })
      .filter(Boolean);
  }

  return Object.freeze({
    async scan({ context, serverId, ttlMs = 60_000 }) {
      if (!context?.actorId || !context?.guildId || !context?.channelId) {
        throw new TypeError('Complete actor context is required.');
      }
      if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000) {
        throw new TypeError('Online-player selection ttlMs is invalid.');
      }

      const now = clock();
      const trusted = await observedTrustedPlayers(serverId);
      return Object.freeze(trusted.map(player => {
        const playerRef = uuid();
        selections.set(playerRef, Object.freeze({
          playerRef,
          actorId: context.actorId,
          guildId: context.guildId,
          channelId: context.channelId,
          serverId,
          eosId: player.eosId,
          displayName: player.displayName,
          expiresAt: now + ttlMs
        }));
        return Object.freeze({
          playerRef,
          displayName: player.displayName,
          serverId,
          expiresAt: now + ttlMs
        });
      }));
    },

    resolve(playerRef, context) {
      const selection = selections.get(String(playerRef || ''));
      if (!selection) throw new Error('The selected online player is no longer available.');
      if (clock() > selection.expiresAt) {
        selections.delete(selection.playerRef);
        throw new Error('The selected online player has expired.');
      }
      if (
        selection.actorId !== context?.actorId ||
        selection.guildId !== context?.guildId ||
        selection.channelId !== context?.channelId
      ) {
        throw new Error('The selected online player is not valid for this interaction.');
      }
      return selection;
    },

    async revalidate({ playerRef, serverId, eosId }) {
      const selection = selections.get(String(playerRef || ''));
      if (!selection || clock() > selection.expiresAt) return Object.freeze({ online: false });
      if (selection.serverId !== serverId || selection.eosId !== String(eosId).toLowerCase()) {
        return Object.freeze({ online: false });
      }
      const observed = await observedTrustedPlayers(serverId);
      const match = observed.find(player => player.eosId === selection.eosId);
      return Object.freeze({ online: Boolean(match), player: match || null });
    }
  });
}

module.exports = {
  createOnlinePlayerSelectionService,
  extractPlayers,
  normalizeObservedPlayer
};
