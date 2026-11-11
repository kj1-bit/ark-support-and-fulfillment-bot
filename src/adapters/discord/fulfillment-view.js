'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const button = (customId, label, style = 2, disabled = false) =>
  ({ type: 2, custom_id: customId, label, style, disabled });
const row = components => ({ type: 1, components });
const select = (customId, placeholder, options, type = 3) =>
  ({ type, custom_id: customId, placeholder, min_values: 1, max_values: 1, ...(type === 3 ? { options } : {}) });
const route = (action, token) => `v2:fulfillment:${action}:${token}`;
const safeText = value => String(value || 'Unknown').slice(0, 100);

function fulfillmentPanelView() {
  return { embeds: [{ title: 'Dino Fulfillment', description: 'Browse or search the catalog to fulfill a verified online player.' }],
    components: [row([button('v2:fulfillment:browse', 'Browse Dino Catalog', 1),
      button('v2:fulfillment:search', 'Search Dino')])] };
}
function playerNamesPanelView() {
  return { content: 'Click below to set or update your in-game name.',
    components: [row([button('v2:player-name:set', 'Set My In-Game Name', 1),
      button('v2:player-name:verify', 'Verify Player Name'),
      button('v2:player-name:link', 'Link Player'),
      button('v2:player-name:unlink', 'Unlink Player')])] };
}
function catalogSearchModal(token) {
  return new ModalBuilder().setCustomId(route('query', token)).setTitle('Search Dino').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('query')
      .setLabel('Dino name').setStyle(TextInputStyle.Short).setMaxLength(64).setRequired(true)));
}
function navigation(token) {
  return [button(route('back', token), 'Back to Catalog'), button(route('close', token), 'Cancel')];
}
function catalogView(result, token) {
  const results = result.results || [];
  return { content: results.length ? `Dino Catalog — Page ${result.page}` : 'No matching creatures found.',
    components: [
      ...(results.length ? [row([select(route('creature', token), 'Select a creature',
        results.map(item => ({ label: safeText(item.name), value: item.id,
          ...(item.dlc?.warning ? { description: safeText(item.dlc.warning) } : {}) })))])] : []),
      row([button(route('previous', token), 'Previous', 2, result.page <= 1),
        button(route('next', token), 'Next', 2, result.page * result.pageSize >= result.total),
        button(route('search', token), 'Search'), button(route('close', token), 'Cancel')])
    ] };
}
function creatureView(creature, token) {
  return { content: `Selected creature: ${creature.name}`,
    components: [row([button(route('online', token), 'Select Online Player', 1), ...navigation(token)])] };
}
function pageControls(token, page, total, pageSize = 25) {
  return [button(route('previous', token), 'Previous', 2, page <= 1),
    button(route('next', token), 'Next', 2, page * pageSize >= total)];
}
function serverSelectionView(servers, token, linking = false, page = 1) {
  return { content: `${linking ? 'Select the map where this Discord member is online.'
    : 'Select the map to scan for verified online players.'} — Page ${page}`,
    components: [
      ...(servers.length ? [row([select(route('server', token), 'Select a map',
        servers.slice((page - 1) * 25, page * 25).map(server => ({ label: safeText(server.name), value: server.id })))])] : []),
      row([...pageControls(token, page, servers.length),
        ...(linking ? [button(route('close', token), 'Cancel')] : navigation(token))])
    ] };
}
function memberSelectionView(token, linking, unlinking = false) {
  return { content: unlinking ? 'Unlink Player: Select the Discord member whose in-game identity should be unlinked.'
    : linking ? 'Link Player: Select the Discord member to link to an in-game identity. The player does not need to be online.'
      : 'Select the Discord member whose submitted name should be verified.',
    components: [row([select(route('member', token), 'Select a Discord member', null, 5)]),
      row([button(route('close', token), 'Cancel')])] };
}
function rememberedPlayerDescription(player) {
  const status = player.trusted ? 'Already linked' : player.serverId === 'previous-link'
    ? 'Previously linked' : `Last seen: ${player.serverName || player.serverId}`;
  return `EOS ${player.maskedEos} - ${status}`;
}
function playerSelectionView({ content, customId, players, token, linking, page, total, pageSize, showBack = true }) {
  return { content: `${content}${page ? ` — Page ${page}` : ''}`, allowedMentions: { parse: [] }, components: [
    ...(players.length ? [row([select(customId, linking ? 'Select a remembered player' : 'Select an online player',
      players.slice(0, 25).map(player => ({ label: safeText(player.displayName),
        value: player.playerRef, description: safeText(linking
          ? rememberedPlayerDescription(player)
          : player.trusted ? `Verified identity - ${player.serverId || 'Online'}` : 'Unverified observation') })))])] : []),
    ...(token ? [row([
      ...(page ? pageControls(token, page, total, pageSize) : []),
      ...(linking ? [button(route('manual', token), 'Enter Player Manually', 1)] : []),
      ...(linking || !showBack ? [button(route('close', token), 'Cancel')] : navigation(token))
    ])] : [])
  ] };
}
function manualPlayerModal(token) {
  return new ModalBuilder().setCustomId(route('manual-submit', token)).setTitle('Link Player Manually').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('player-name')
      .setLabel('In-game player name').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('eos-id')
      .setLabel('EOS ID (32 hexadecimal characters)').setStyle(TextInputStyle.Short).setMinLength(32).setMaxLength(32).setRequired(true)));
}
function unlinkPlayerView(player, token) {
  const { maskEosId } = require('./fulfillment-controller');
  return { content: `Unlink Player for <@${player.discordId}>?\nIn-game player: ${player.displayName}\nEOS ID: ${maskEosId(player.eosId)}\nThis removes the trusted identity link only. The submitted player name is unchanged. Unlink first, then link the correct player.`,
    allowedMentions: { parse: [] }, embeds: [], components: [row([
      button(route('unlink', token), 'Confirm Unlink', 4), button(route('close', token), 'Cancel')
    ])] };
}
function confirmationView(model) {
  return { content: model.notice, embeds: [{ title: 'Review Dino Fulfillment', fields: [
    { name: 'Player', value: model.playerName }, { name: 'Creature', value: model.creatureName },
    { name: 'Server', value: model.serverId }, { name: 'Catalog version', value: model.catalogVersion }
  ] }], components: [row([button(route('confirm', model.token), 'Confirm Spawn', 4),
    button(route('cancel', model.token), 'Cancel')])] };
}
function resultView(result) {
  return { content: `Fulfillment status: ${result.state}`, components: [], embeds: [] };
}
module.exports = { confirmationView, playerSelectionView, resultView, fulfillmentPanelView,
  playerNamesPanelView, catalogSearchModal, catalogView, creatureView, serverSelectionView, memberSelectionView,
  manualPlayerModal, unlinkPlayerView };
