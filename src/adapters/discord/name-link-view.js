'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown } = require('discord.js');
const safe = value => escapeMarkdown(String(value || 'Unknown').slice(0, 64)
  .replace(/[\r\n<>]/g, ' ').replace(/@/g, '@\u200b'), { maskedLink:true });
const label = value => String(value || 'Unknown').replace(/[\r\n]/g, ' ').slice(0, 100);
const row = components => ({ type:1, components });
const button = (id, text, disabled = false, style = 2) => ({ type:2, custom_id:id, label:text, style, disabled });
const select = (id, placeholder, options, type = 3) => ({
  type, custom_id:id, placeholder, min_values:1, max_values:1, ...(type === 3 ? { options } : {})
});
const id = (action, token) => `v2:name-link:${action}:${token}`;
const lastSeen = player => player.lastSeenAt == null ? 'Last seen: unavailable'
  : `Last seen: ${safe(player.serverName || player.serverId)} <t:${Math.floor(player.lastSeenAt / 1000)}:R>`;
const mask = eos => `${eos.slice(0, 4)}…${eos.slice(-4)}`;
const mention = request => `<@${request.discordId}> said their in-game name is "${safe(request.playerName)}"${request.status === 'VERIFIED' ? ' (previously verified)' : ''}.`;

function panel(result) {
  const last = Math.max(1, Math.ceil(result.total / result.pageSize));
  return { embeds:[{ title:`Player name requests · page ${result.page}`,
    description:result.results.length ? result.results.map(mention).join('\n\n') : 'No player name requests awaiting a link.',
    color:0x5865f2 }], allowedMentions:{ parse:[] }, components:[row([
    button('v2:name-requests:link', 'Link Player', !result.total, 1),
    button('v2:name-requests:unlink', 'Unlink Player'),
    button(`v2:name-requests:previous:${Math.max(1, result.page - 1)}`, 'Previous', result.page <= 1),
    button(`v2:name-requests:next:${Math.min(last, result.page + 1)}`, 'Next', result.page >= last),
    button(`v2:name-requests:refresh:${result.page}`, 'Refresh')
  ])] };
}
function picker(result, token) {
  const last = Math.max(1, Math.ceil(result.total / result.pageSize));
  return { content:result.results.length
    ? `Select a request to link · page ${result.page}\n${result.results.map((r,i) => `${i + 1}. ${mention(r)}`).join('\n')}`
    : 'No player name requests awaiting a link.', allowedMentions:{ parse:[] }, embeds:[], components:[
    ...(result.results.length ? [row([select(id('request', token), 'Select a request', result.results.map((r,i) => ({
      label:label(`${i + 1}. ${r.playerName}`), value:r.discordId
    })))])] : []),
    row([button(id('previous', token), 'Previous', result.page <= 1),
      button(id('next', token), 'Next', result.page >= last), button(id('close', token), 'Cancel')])
  ] };
}
function candidates(request, result, token, browsing) {
  const last = Math.max(1, Math.ceil(result.total / result.pageSize));
  const intro = browsing ? 'Browse all remembered players' : 'Matching remembered players';
  return { content:`${intro} for <@${request.discordId}>, who said "${safe(request.playerName)}".`
    + (result.players.length ? '' : ' No matching remembered players found.')
    + (browsing ? ` · page ${result.page}` : ''), allowedMentions:{ parse:[] }, embeds:[], components:[
    ...(result.players.length ? [row([select(id('candidate',token), 'Select a remembered player', result.players.map(p => ({
      label:label(p.displayName), value:p.playerRef,
      description:label(`${p.trusted ? 'Already linked · ' : ''}EOS ${p.maskedEos} · ${String(p.serverName || p.serverId).slice(0, 25)} · ${p.lastSeenAt == null ? 'time unavailable' : new Date(p.lastSeenAt).toISOString()}`)
    })))])] : []),
    ...(browsing ? [row([button(id('previous',token),'Previous',result.page <= 1),
      button(id('next',token),'Next',result.page >= last)])] : []),
    row([button(id('refresh',token),'Refresh'), button(id('browse',token),browsing ? 'Matching Players' : 'Browse All Remembered Players'),
      button(id('manual',token),'Enter EOS Manually'), button(id('close',token),'Cancel')])
  ] };
}
function manual(token, name) {
  return new ModalBuilder().setCustomId(id('manual-submit',token)).setTitle('Link Player Manually').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('player-name').setLabel('In-game player name')
      .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true).setValue(name)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('eos-id').setLabel('EOS ID (32 hexadecimal characters)')
      .setStyle(TextInputStyle.Short).setMinLength(32).setMaxLength(32).setRequired(true)));
}
function review(request, player, token) {
  return { content:`Review link for <@${request.discordId}>.\nThey said: **${safe(request.playerName)}**\n`
    + `In-game player: **${safe(player.displayName)}**\nEOS: ${mask(player.eosId)}\n${lastSeen(player)}`,
  allowedMentions:{ parse:[] }, embeds:[], components:[row([
    button(id('confirm',token),'Confirm Link',false,3), button(id('close',token),'Cancel')])] };
}
function unlinkPicker(token) {
  return { content:'Select the Discord member whose in-game identity should be unlinked.',
    allowedMentions:{ parse:[] }, embeds:[], components:[
      row([select(id('member',token),'Select a Discord member',null,5)]),row([button(id('close',token),'Cancel')])] };
}
function unlinkReview(player, token) {
  return { content:`Unlink Player for <@${player.discordId}>?\nIn-game player: **${safe(player.displayName)}**\n`
    + `EOS: ${mask(player.eosId)}\nTheir submitted name will return to the request queue.`,
  allowedMentions:{ parse:[] }, embeds:[], components:[row([
    button(id('unlink-confirm',token),'Confirm Unlink',false,4),button(id('close',token),'Cancel')])] };
}
module.exports = { safe, panel, picker, candidates, manual, review, unlinkPicker, unlinkReview };
