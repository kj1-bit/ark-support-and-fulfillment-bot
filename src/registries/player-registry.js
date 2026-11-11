'use strict';

const EOS = /^[0-9a-f]{32}$/i;
const SNOW = /^[1-9][0-9]{16,19}$/;
function createPlayerRegistry(records) {
  if (!Array.isArray(records)) throw new TypeError('Player records must be an array.');
  const byDiscord = new Map(), byEos = new Map();
  function addVerified(item) {
    if (!SNOW.test(item.discordId || '')) throw new TypeError('Invalid Discord player ID.');
    if (!EOS.test(item.eosId || '')) throw new TypeError('Invalid EOS player ID.');
    if (item.verified !== true) throw new TypeError('Unverified player cannot enter the trusted registry.');
    const eos = item.eosId.toLowerCase();
    const d = byDiscord.get(item.discordId), e = byEos.get(eos);
    if ((d && d.eosId !== eos) || (e && e.discordId !== item.discordId)) {
      throw new TypeError('Duplicate trusted player identity.');
    }
    if (d) byEos.delete(d.eosId);
    const r = Object.freeze({ ...item,eosId:eos });
    byDiscord.set(r.discordId,r);
    byEos.set(eos,r);
    return r;
  }
  for (const r of records) addVerified(r);
  return Object.freeze({
    addVerified,
    remove(discordId) {
      const existing = byDiscord.get(discordId);
      if (existing) byEos.delete(existing.eosId);
      return byDiscord.delete(discordId);
    },
    byDiscord:id => byDiscord.get(id) || null,
    byEos:id => byEos.get(String(id).toLowerCase()) || null,
    list:() => Object.freeze([...byDiscord.values()])
  });
}
module.exports = { createPlayerRegistry };
