'use strict';

const crypto = require('node:crypto');
const EOS = /^[0-9a-f]{32}$/i;
const MAX_SELECTIONS = 1000;
const MAX_RESULTS = 25;
function extractPlayers(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.players)) return result.players;
  return [];
}
function normalizeObservedPlayer(input) {
  const eosId = String(input?.eosId || input?.eos || input?.EOS || input?.uniqueNetId || '').toLowerCase();
  if (!EOS.test(eosId)) return null;
  const displayName = String(input?.displayName || input?.name || input?.playerName || '').slice(0, 64);
  if (!displayName) return null;
  return Object.freeze({ eosId, displayName });
}
function createOnlinePlayerSelectionService({ players, ark, clock = Date.now, uuid = crypto.randomUUID }) {
  if (!players || typeof players.byEos !== 'function') throw new TypeError('trusted player registry is required.');
  if (!ark || typeof ark.listOnlinePlayers !== 'function') throw new TypeError('ark.listOnlinePlayers is required.');
  const selections = new Map();
  function removeExpired(now) {
    for (const [ref, selection] of selections) if (selection.expiresAt <= now) selections.delete(ref);
  }
  function makeRoom() {
    while (selections.size >= MAX_SELECTIONS) selections.delete(selections.keys().next().value);
  }
  async function observed(serverId) {
    return extractPlayers(await ark.listOnlinePlayers(serverId)).map(normalizeObservedPlayer).filter(Boolean).map(observation => {
      const trusted = players.byEos(observation.eosId);
      return Object.freeze({ eosId: observation.eosId, displayName: trusted?.displayName || observation.displayName,
        discordId: trusted?.discordId || null, serverId, trusted: Boolean(trusted) });
    });
  }
  async function scanPage({ context, serverId, serverIds, ttlMs = 60000, includeUntrusted = false, page = 1 }) {
    if (!context?.actorId || !context?.guildId || !context?.channelId) throw new TypeError('Complete actor context is required.');
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 300000) throw new TypeError('Online-player selection ttlMs is invalid.');
    if (!Number.isSafeInteger(page) || page < 1) throw new TypeError('Online-player selection page is invalid.');
    removeExpired(clock());
    if (serverIds !== undefined && (!Array.isArray(serverIds) || serverIds.some(id => typeof id !== 'string' || !id))) {
      throw new TypeError('Online-player scan servers are invalid.');
    }
    const targets = serverIds === undefined ? [serverId] : [...new Set(serverIds)];
    const list = [];
    // Scan sequentially to bound RCON load; any failed map fails the scan rather than hiding players.
    for (const target of targets) {
      list.push(...(await observed(target)).filter(player => includeUntrusted || player.trusted));
    }
    const now = clock();
    removeExpired(now);
    const lastPage = Math.max(1, Math.ceil(list.length / MAX_RESULTS));
    const currentPage = Math.min(page, lastPage);
    const results = list.slice((currentPage - 1) * MAX_RESULTS, currentPage * MAX_RESULTS).map(player => {
      makeRoom();
      const playerRef = uuid();
      selections.set(playerRef, Object.freeze({ ...player, playerRef, actorId: context.actorId,
        guildId: context.guildId, channelId: context.channelId, expiresAt: now + ttlMs }));
      return Object.freeze({ playerRef, displayName: player.displayName, serverId: player.serverId,
        trusted: player.trusted, expiresAt: now + ttlMs });
    });
    return Object.freeze({ players: Object.freeze(results), page: currentPage, pageSize: MAX_RESULTS, total: list.length });
  }
  return Object.freeze({
    async scan(input) { return (await scanPage({ ...input, page: 1 })).players; },
    scanPage,
    resolve(ref, context, { allowUntrusted = false } = {}) {
      const key = String(ref || '');
      const selection = selections.get(key);
      if (!selection) throw new Error('The selected online player is no longer available.');
      if (clock() >= selection.expiresAt) {
        selections.delete(key);
        throw new Error('The selected online player has expired.');
      }
      if (selection.actorId !== context?.actorId || selection.guildId !== context?.guildId
        || selection.channelId !== context?.channelId) {
        throw new Error('The selected online player is not valid for this interaction.');
      }
      if (!allowUntrusted && !selection.trusted) throw new Error('The selected online player is not verified.');
      return selection;
    },
    consume(ref) { return selections.delete(String(ref || '')); },
    async revalidate({ playerRef, serverId, eosId }) {
      const key = String(playerRef || '');
      const selection = selections.get(key);
      if (!selection) return Object.freeze({ online: false });
      if (clock() >= selection.expiresAt || !selection.trusted || selection.serverId !== serverId
        || selection.eosId !== String(eosId).toLowerCase()) {
        selections.delete(key);
        return Object.freeze({ online: false });
      }
      const match = (await observed(serverId)).find(player => player.trusted && player.eosId === selection.eosId);
      selections.delete(key);
      return Object.freeze({ online: Boolean(match), player: match || null });
    }
  });
}
module.exports = { createOnlinePlayerSelectionService, extractPlayers, normalizeObservedPlayer };
