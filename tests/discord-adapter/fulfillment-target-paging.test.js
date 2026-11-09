'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordRouter } = require('../../src/adapters/discord/router');
const { createFulfillmentController } = require('../../src/adapters/discord/fulfillment-controller');
const { createOnlinePlayerSelectionService } = require('../../src/application/online-player-selection-service');
const { createCatalogSearchService } = require('../../src/domain/shop/catalog-search-service');
const { createPlayerRegistry } = require('../../src/registries/player-registry');
const views = require('../../src/adapters/discord/fulfillment-view');
const actorId = '10000000000000001', guildId = '10000000000000002', channelId = '10000000000000003';
const privateId = '10000000000000004', panelId = '10000000000000005', targetId = '10000000000000006';
const rows = view => view.components.flatMap(row => row.components);
const component = (view, label) => rows(view).find(item => item.label === label || item.placeholder === label);
function interaction(kind, customId, values = [], overrides = {}) {
  const i = { user: { id: actorId }, guildId, channelId, message: { id: privateId }, customId, values,
    isChatInputCommand: () => false, isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select', isUserSelectMenu: () => kind === 'member',
    reply: async payload => payload, followUp: async payload => payload,
    deferReply: async () => { i.deferred = true; }, deferUpdate: async () => { i.deferred = true; },
    editReply: async payload => ({ ...payload, id: privateId }), ...overrides };
  return i;
}
function setup(linking = false) {
  const observations = Array.from({ length: 26 }, (_, index) => ({
    eosId: (index + 1).toString(16).padStart(32, '0'), displayName: `Online Player ${index + 1}`
  }));
  const players = createPlayerRegistry(linking ? [] : observations.map((player, index) => ({
    ...player, discordId: String(BigInt(targetId) + BigInt(index)), verified: true
  })));
  const scans = [], pending = [], sessions = [], associations = [], capabilities = [];
  let nextRef = 0;
  const onlinePlayers = createOnlinePlayerSelectionService({ players,
    ark: { listOnlinePlayers: async serverId => { scans.push(serverId); return observations; } },
    uuid: () => `observed-reference-${++nextRef}` });
  const catalog = { version: 'current', creatures: [{ id: 'rex', name: 'Rex', enabled: true, tameable: true }],
    get: id => { assert.equal(id, 'rex'); return catalog.creatures[0]; } };
  const catalogManager = { current: () => catalog };
  const services = {
    authorization: { authorize: (capability, context) => { capabilities.push(capability); assert.equal(context.actorId, actorId); } },
    onlinePlayers, players, catalogManager, shop: createCatalogSearchService({ catalogManager }),
    fulfillment: { createPending: async input => { pending.push(input); return { id: 'pending' }; } },
    interactionGuard: { issue: async input => { sessions.push(input); return { token: 'confirmation-token', expiresAt: Date.now() + 120000 }; } },
    playerRepository: { save: async record => associations.push(record) }, playerNames: { verify: async () => ({}) }
  };
  const servers = Array.from({ length: 26 }, (_, index) => ({
    id: `map-${index + 1}`, name: `Map ${index + 1}`, enabled: true,
    operations: ['listOnlinePlayers', 'fulfillApprovedCreature']
  }));
  const router = createDiscordRouter({ controller: createFulfillmentController({ services }), views,
    logSink: async () => {}, config: { ark: { servers } },
    panelMatches: i => i.message.id === panelId, playerPanelMatches: i => i.message.id === panelId });
  return { router, observations, scans, pending, sessions, associations, capabilities, onlinePlayers, players };
}
async function openMaps(state, linking = false) {
  if (linking) {
    const members = await state.router.handle(interaction('button', 'v2:player-name:link', [], { message: { id: panelId } }));
    return state.router.handle(interaction('member', component(members, 'Select a Discord member').custom_id, [targetId]));
  }
  const catalog = await state.router.handle(interaction('button', 'v2:fulfillment:browse', [], { message: { id: panelId } }));
  const creature = await state.router.handle(interaction('select', component(catalog, 'Select a creature').custom_id, ['rex']));
  return state.router.handle(interaction('button', component(creature, 'Select Online Player').custom_id));
}
async function next(state, view) {
  return state.router.handle(interaction('button', component(view, 'Next').custom_id));
}
test('26th enabled map and trusted online player are reachable and issue review on exact private message', async () => {
  const state = setup();
  const firstMaps = await openMaps(state);
  assert.equal(component(firstMaps, 'Select a map').options.length, 25);
  assert.equal(component(firstMaps, 'Previous').disabled, true);
  const secondMaps = await next(state, firstMaps);
  assert.deepEqual(component(secondMaps, 'Select a map').options.map(option => option.value), ['map-26']);
  assert.equal(component(secondMaps, 'Next').disabled, true);
  const firstPlayers = await state.router.handle(interaction('select', component(secondMaps, 'Select a map').custom_id, ['map-26']));
  assert.equal(component(firstPlayers, 'Select an online player').options.length, 25);
  const secondPlayers = await next(state, firstPlayers);
  const menu = component(secondPlayers, 'Select an online player');
  assert.equal(menu.options.length, 1);
  assert.equal(menu.options[0].label, 'Online Player 26');
  const ref = menu.options[0].value;
  assert.notEqual(ref, state.observations[25].eosId);
  const review = await state.router.handle(interaction('select', menu.custom_id, [ref]));
  assert.equal(review.embeds[0].title, 'Review Dino Fulfillment');
  assert.equal(state.pending[0].serverId, 'map-26');
  assert.equal(state.pending[0].eosId, state.observations[25].eosId);
  assert.equal(state.pending[0].playerRef, ref);
  assert.equal(state.pending[0].context.messageId, privateId);
  assert.equal(state.sessions[0].messageId, privateId);
  assert.equal(state.sessions[0].guildId, guildId);
  assert.equal(state.sessions[0].channelId, channelId);
  assert.deepEqual(state.scans, ['map-26', 'map-26']);
});
test('26th staff linking candidate on 26th map associates selected Discord member using observed trusted ref', async () => {
  const state = setup(true);
  const secondMaps = await next(state, await openMaps(state, true));
  const firstPlayers = await state.router.handle(interaction('select', component(secondMaps, 'Select a map').custom_id, ['map-26']));
  const secondPlayers = await next(state, firstPlayers);
  const menu = component(secondPlayers, 'Select an online player');
  assert.equal(menu.options[0].description, 'Unverified observation');
  await state.router.handle(interaction('select', menu.custom_id, [menu.options[0].value]));
  assert.equal(state.associations.length, 1);
  assert.equal(state.associations[0].discordId, targetId);
  assert.equal(state.associations[0].eosId, state.observations[25].eosId);
  assert.equal(state.associations[0].source, 'observed:map-26');
  assert.equal(state.players.byDiscord(targetId).eosId, state.observations[25].eosId);
  assert.throws(() => state.onlinePlayers.resolve(menu.options[0].value,
    { actorId, guildId, channelId }, { allowUntrusted: true }), /no longer available/);
  assert(state.capabilities.every(capability => capability === 'player-names.verify'));
});
test('map and online-player paging remain actor/guild/channel/message-bound and selections are restricted to displayed page', async () => {
  const state = setup();
  const maps = await openMaps(state);
  for (const overrides of [{ user: { id: targetId } }, { guildId: targetId }, { channelId: targetId },
    { message: { id: panelId } }]) {
    const denied = await state.router.handle(interaction('button', component(maps, 'Next').custom_id, [], overrides));
    assert.equal(denied.flags, 64);
  }
  const secondMaps = await next(state, maps);
  const mapMenu = component(secondMaps, 'Select a map');
  assert.equal((await state.router.handle(interaction('select', mapMenu.custom_id, ['map-1']))).flags, 64);
  const players = await state.router.handle(interaction('select', mapMenu.custom_id, ['map-26']));
  const oldRef = component(players, 'Select an online player').options[0].value;
  for (const overrides of [{ user: { id: targetId } }, { guildId: targetId }, { channelId: targetId },
    { message: { id: panelId } }]) {
    assert.equal((await state.router.handle(interaction('button', component(players, 'Next').custom_id, [], overrides))).flags, 64);
  }
  assert.equal(state.scans.length, 1);
  const secondPlayers = await next(state, players);
  const menu = component(secondPlayers, 'Select an online player');
  assert.equal((await state.router.handle(interaction('select', menu.custom_id, [oldRef]))).flags, 64);
  assert.equal(state.pending.length, 0);
  const previousPlayers = await state.router.handle(interaction('button', component(secondPlayers, 'Previous').custom_id));
  assert.equal(component(previousPlayers, 'Select an online player').options.length, 25);
  assert.equal(component(previousPlayers, 'Previous').disabled, true);
});
test('online scanPage preserves legacy first-page scan and clamps pages after changing online population', async () => {
  const state = setup();
  const context = { actorId, guildId, channelId };
  assert.equal((await state.onlinePlayers.scan({ context, serverId: 'map-1' })).length, 25);
  const second = await state.onlinePlayers.scanPage({ context, serverId: 'map-1', page: 2 });
  assert.equal(second.total, 26);
  assert.equal(second.page, 2);
  assert.equal(second.players.length, 1);
  state.observations.splice(20);
  const clamped = await state.onlinePlayers.scanPage({ context, serverId: 'map-1', page: 2 });
  assert.equal(clamped.page, 1);
  assert.equal(clamped.total, 20);
  await assert.rejects(state.onlinePlayers.scanPage({ context, serverId: 'map-1', page: 0 }), /page is invalid/);
});
