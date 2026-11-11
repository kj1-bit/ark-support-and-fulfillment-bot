'use strict';

const { normalizePlayerName } = require('../domain/player-names/player-name-service');
const EOS = /^[0-9a-f]{32}$/i;
const SNOW = /^[1-9][0-9]{16,19}$/;

function linkError(code, message) {
  return Object.assign(new Error(message), { code });
}
function createPlayerLinkService({ repository, players, audit, clock = Date.now }) {
  let pending = Promise.resolve();
  function serialize(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }
  function assertUnlinked(discordId, eosId) {
    if (!SNOW.test(discordId || '')) throw new TypeError('Invalid Discord player ID.');
    if (players.byDiscord(discordId)) {
      throw linkError('PLAYER_ALREADY_LINKED', 'This Discord member is already linked. Use Unlink Player first, then link again.');
    }
    if (eosId && players.byEos(eosId)) {
      throw linkError('IDENTITY_ALREADY_LINKED', 'This in-game identity is already linked. Use Unlink Player on its current Discord member first.');
    }
  }
  return Object.freeze({
    assertUnlinked,
    get: discordId => players.byDiscord(discordId),
    link({ discordId, eosId, displayName, source, actorId, manual = false }) {
      return serialize(async () => {
        if (typeof eosId !== 'string' || eosId.length !== 32 || !EOS.test(eosId)) {
          throw linkError('INVALID_LINK_EOS', 'EOS ID must contain exactly 32 hexadecimal characters.');
        }
        const name = manual ? normalizePlayerName(displayName) : displayName;
        if (typeof name !== 'string' || !name.trim() || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) {
          throw new TypeError('Player name contains unsupported characters or length.');
        }
        assertUnlinked(discordId, eosId);
        const record = Object.freeze({ discordId, eosId: eosId.toLowerCase(), displayName: name,
          verified: true, verifiedAt: clock(), source });
        await repository.insert(record);
        players.addVerified(record);
        audit.write('player-link.created', { discordId, actorId, source });
        return record;
      });
    },
    unlink({ discordId, eosId, actorId }) {
      return serialize(async () => {
        const current = players.byDiscord(discordId);
        if (!current) throw linkError('PLAYER_NOT_LINKED', 'This Discord member has no linked in-game identity.');
        if (current.eosId !== eosId) throw linkError('LINK_CHANGED', 'This link has changed. Start Unlink Player again.');
        await repository.remove(discordId, eosId);
        players.remove(discordId);
        audit.write('player-link.removed', { discordId, actorId });
        return current;
      });
    }
  });
}

module.exports = { createPlayerLinkService };
