'use strict';

const crypto = require('node:crypto');
const { toInteractionContext } = require('./interaction-context');
const { isButton, isStringSelect, isModal } = require('./interaction-protocol');
const { fetchPrivatePinChannel } = require('./staff-pin-channel');
const { normalizePlayerName } = require('../../domain/player-names/player-name-service');
const views = require('./name-link-view');

const TTL = 120000;
function createNameLinkRouter(context, panel) {
  const flows = new Map();
  function store(interaction, data) {
    for (const [key, flow] of flows) if (flow.expiresAt <= Date.now()) flows.delete(key);
    while (flows.size >= 500) flows.delete(flows.keys().next().value);
    const token = crypto.randomUUID();
    flows.set(token, { ...data, actorId:interaction.user.id, guildId:interaction.guildId,
      channelId:interaction.channelId, expiresAt:Date.now() + TTL });
    return token;
  }
  async function authorize(interaction) {
    const user = toInteractionContext(interaction, { requireMessage:true });
    context.services.authorization.authorize('player-names.verify', user);
    try { await fetchPrivatePinChannel(context); }
    catch (error) {
      await panel.refresh(context);
      throw error;
    }
    return user;
  }
  async function render(interaction, data, build) {
    const token = store(interaction, data);
    try {
      const message = await interaction.editReply(build(token));
      flows.get(token).messageId = message?.id || (await interaction.fetchReply()).id;
      if (!flows.get(token).messageId) throw new Error('A private wizard message is required.');
      return message;
    } catch (error) {
      flows.delete(token);
      throw error;
    }
  }
  async function showPicker(interaction, user, page) {
    const result = await context.services.playerNames.queue({ page, context:user });
    return render(interaction, { stage:'requests', page:result.page, total:result.total,
      requests:result.results }, token => views.picker(result,token));
  }
  async function showCandidates(interaction, user, flow) {
    const options = { context:user, ttlMs:TTL };
    const result = flow.browsing
      ? await context.services.onlinePlayers.scanPage({ ...options, remembered:true, page:flow.page || 1 })
      : await context.services.onlinePlayers.matching({ ...options, name:flow.request.playerName });
    const players = result.players.map(player => ({ ...player,
      serverName:context.config.ark?.servers?.find(server => server.id === player.serverId)?.name || player.serverId }));
    return render(interaction, { ...flow, stage:'candidates', page:result.page, total:result.total,
      refs:players.map(player => player.playerRef) }, token => views.candidates(flow.request,{ ...result,players },token,flow.browsing));
  }
  async function showReview(interaction, flow, player) {
    return render(interaction, { ...flow, stage:'review', player }, token => views.review(flow.request,player,token));
  }
  async function handle(interaction) {
    const customId = String(interaction.customId || '');
    if (isButton(interaction) && ['v2:name-requests:link','v2:name-requests:unlink'].includes(customId)) {
      if (!panel.matches(interaction)) throw new Error('This staff panel is no longer valid.');
      const user = await authorize(interaction);
      await interaction.deferReply({ flags:64 });
      if (customId.endsWith(':unlink')) return render(interaction, { stage:'unlink-picker' }, views.unlinkPicker);
      return showPicker(interaction,user,1);
    }
    const match = customId.match(/^v2:name-link:([a-z-]+):([^:]+)$/);
    if (!match) return false;
    const [,action,token] = match;
    const flow = flows.get(token);
    if (!flow || flow.expiresAt <= Date.now() || flow.actorId !== interaction.user.id
      || flow.guildId !== interaction.guildId || flow.channelId !== interaction.channelId
      || flow.messageId !== interaction.message?.id) throw new Error('This selection flow is invalid or expired.');
    const user = await authorize(interaction);
    if (flow.expiresAt <= Date.now()) throw new Error('This selection flow is invalid or expired.');
    if (action === 'manual' && isButton(interaction) && flow.stage === 'candidates') {
      flows.delete(token);
      const next = store(interaction, { ...flow, stage:'manual' });
      flows.get(next).messageId = flow.messageId;
      return interaction.showModal(views.manual(next,flow.request.playerName));
    }
    if (action === 'manual-submit' && isModal(interaction) && flow.stage === 'manual') {
      const displayName = normalizePlayerName(interaction.fields.getTextInputValue('player-name'));
      const eosId = interaction.fields.getTextInputValue('eos-id').toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(eosId)) {
        throw Object.assign(new Error('Invalid EOS.'), { code:'INVALID_LINK_EOS' });
      }
      context.services.playerLinks.assertUnlinked(flow.request.discordId,eosId);
      flows.delete(token);
      await interaction.deferUpdate();
      return showReview(interaction,flow,{ eosId,displayName,manual:true });
    }
    if (action === 'close' && isButton(interaction)) {
      flows.delete(token);
      await interaction.deferUpdate();
      return interaction.editReply({ content:'Selection canceled.', embeds:[],components:[],allowedMentions:{ parse:[] } });
    }
    if (['previous','next'].includes(action) && isButton(interaction)
      && (flow.stage === 'requests' || (flow.stage === 'candidates' && flow.browsing))) {
      const size = flow.stage === 'requests' ? 10 : 25;
      const page = Math.min(Math.max(1,Math.ceil(flow.total / size)),Math.max(1,flow.page + (action === 'next' ? 1 : -1)));
      flows.delete(token);
      await interaction.deferUpdate();
      return flow.stage === 'requests' ? showPicker(interaction,user,page)
        : showCandidates(interaction,user,{ ...flow,page });
    }
    if (action === 'request' && isStringSelect(interaction) && flow.stage === 'requests') {
      const request = flow.requests.find(item => item.discordId === interaction.values?.[0]);
      if (!request) throw new Error('This selection is invalid.');
      context.services.playerLinks.assertUnlinked(request.discordId);
      flows.delete(token);
      await interaction.deferUpdate();
      return showCandidates(interaction,user,{ request, browsing:false, page:1 });
    }
    if (['refresh','browse'].includes(action) && isButton(interaction) && flow.stage === 'candidates') {
      flows.delete(token);
      await interaction.deferUpdate();
      return showCandidates(interaction,user,{ ...flow, browsing:action === 'browse' ? !flow.browsing : flow.browsing, page:1 });
    }
    if (action === 'candidate' && isStringSelect(interaction) && flow.stage === 'candidates') {
      const ref = interaction.values?.[0];
      if (!flow.refs.includes(ref)) throw new Error('This selection is invalid.');
      const selected = context.services.onlinePlayers.resolve(ref,user,{ allowUntrusted:true });
      context.services.playerLinks.assertUnlinked(flow.request.discordId,selected.eosId);
      const player = { ...selected, serverName:context.config.ark?.servers?.find(server => server.id === selected.serverId)?.name || selected.serverId };
      flows.delete(token);
      await interaction.deferUpdate();
      return showReview(interaction,flow,player);
    }
    if (action === 'confirm' && isButton(interaction) && flow.stage === 'review') {
      flows.delete(token);
      await interaction.deferUpdate();
      const player = flow.player;
      const linked = await context.services.playerLinks.link({ discordId:flow.request.discordId,
        eosId:player.eosId, displayName:player.displayName, manual:player.manual === true,
        source:player.manual ? 'manual' : `observed:${player.serverId}`, actorId:user.actorId,
        request:flow.request, expiresAt:flow.expiresAt });
      context.client.emit('v2PlayerNamesChanged');
      context.client.emit('v2VaultPinsChanged');
      return interaction.editReply({ content:`Linked in-game identity for <@${flow.request.discordId}>: **${views.safe(linked.displayName)}**.`,
        allowedMentions:{ parse:[] }, embeds:[],components:[] });
    }
    if (action === 'member' && interaction.isUserSelectMenu?.() && flow.stage === 'unlink-picker') {
      const discordId = interaction.values?.[0];
      if (!/^[1-9][0-9]{16,19}$/.test(discordId || '')) throw new Error('This selection is invalid.');
      const player = context.services.playerLinks.get(discordId);
      if (!player) throw Object.assign(new Error('Not linked.'), { code:'PLAYER_NOT_LINKED' });
      const current = await context.services.playerNames.linkedName(discordId);
      flows.delete(token);
      await interaction.deferUpdate();
      const linked = { ...player, displayName:current?.displayName || player.displayName };
      return render(interaction, { stage:'unlink-review', player:linked }, id => views.unlinkReview(linked,id));
    }
    if (action === 'unlink-confirm' && isButton(interaction) && flow.stage === 'unlink-review') {
      flows.delete(token);
      await interaction.deferUpdate();
      await context.services.playerLinks.unlink({ discordId:flow.player.discordId,eosId:flow.player.eosId,
        actorId:user.actorId,expiresAt:flow.expiresAt });
      context.client.emit('v2PlayerNamesChanged');
      context.client.emit('v2VaultPinsChanged');
      return interaction.editReply({ content:`Unlinked in-game identity for <@${flow.player.discordId}>. Their submitted name is awaiting a link.`,
        allowedMentions:{ parse:[] }, embeds:[],components:[] });
    }
    throw new Error('This selection is invalid.');
  }
  return Object.freeze({ handle, stop() { flows.clear(); } });
}
module.exports = { createNameLinkRouter };
