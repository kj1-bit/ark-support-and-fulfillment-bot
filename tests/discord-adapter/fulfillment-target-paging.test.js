'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordRouter } = require('../../src/adapters/discord/router');
const { createFulfillmentController } = require('../../src/adapters/discord/fulfillment-controller');
const { createOnlinePlayerSelectionService } = require('../../src/application/online-player-selection-service');
const { createCatalogSearchService } = require('../../src/domain/shop/catalog-search-service');
const { createPlayerRegistry } = require('../../src/registries/player-registry');
const { createPlayerLinkService } = require('../../src/application/player-link-service');
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
function setup(linking = false, unavailable = [], mapName = index => `Map ${index + 1}`) {
  const observations = Array.from({ length: 26 }, (_, index) => ({
    eosId: (index + 1).toString(16).padStart(32, '0'), displayName: `Online Player ${index + 1}`
  }));
  const players = createPlayerRegistry(linking ? [] : observations.map((player, index) => ({
    ...player, discordId: String(BigInt(targetId) + BigInt(index)), verified: true
  })));
  const scans = [], pending = [], sessions = [], associations = [], capabilities = [];
  let nextRef = 0;
  const onlinePlayers = createOnlinePlayerSelectionService({ players,
    audit:{ write() {} },
    rememberedPlayers: { remember:async () => {}, page: async page => ({ players:observations.slice((page-1)*25,page*25).map(player => ({
      ...player,serverId:'map-26' })),page,total:observations.length }) },
    ark: { listOnlinePlayers: async serverId => {
      scans.push(serverId);
      if (unavailable.includes(serverId)) throw new Error('transport failure');
      return serverId === 'map-26' ? observations : [];
    } },
    uuid: () => `observed-reference-${++nextRef}` });
  const catalog = { version: 'current', creatures: [{ id: 'rex', name: 'Rex', enabled: true, tameable: true }],
    get: id => { assert.equal(id, 'rex'); return catalog.creatures[0]; } };
  const catalogManager = { current: () => catalog };
  const services = {
    authorization: { authorize: (capability, context) => { capabilities.push(capability); assert.equal(context.actorId, actorId); } },
    onlinePlayers, players, catalogManager, shop: createCatalogSearchService({ catalogManager }),
    fulfillment: { createPending: async input => { pending.push(input); return { id: 'pending' }; } },
    interactionGuard: { issue: async input => { sessions.push(input); return { token: 'confirmation-token', expiresAt: Date.now() + 120000 }; } },
    playerLinks: createPlayerLinkService({ players,
      repository:{ insert:async record => associations.push(record) },audit:{ write() {} } }),
    playerNames: { verify: async () => ({}) }
  };
  const servers = Array.from({ length: 26 }, (_, index) => ({
    id: `map-${index + 1}`, name: mapName(index), enabled: true,
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
test('cross-map scan reaches the 26th map and pages trusted players without a map-selection step', async () => {
  const state = setup();
  const firstPlayers = await openMaps(state);
  assert.equal(component(firstPlayers, 'Select a map'), undefined);
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
  assert.deepEqual(state.scans, [...Array.from({ length:26 }, (_,i) => `map-${i+1}`),
    ...Array.from({ length:26 }, (_,i) => `map-${i+1}`)]);
});
test('26th remembered candidate remains available without a live scan', async () => {
  const state = setup(true);
  const context = { actorId,guildId,channelId };
  const result = await state.onlinePlayers.scanPage({ context,remembered:true,page:2 });
  assert.equal(result.players.length,1);
  assert.equal(result.players[0].displayName,'Online Player 26');
  assert.deepEqual(state.scans, []);
  assert.equal(state.onlinePlayers.resolve(result.players[0].playerRef,context,{ allowUntrusted:true }).eosId,
    state.observations[25].eosId);
});
test('cross-map online-player paging remains actor/guild/channel/message-bound and restricted to displayed refs', async () => {
  const state = setup();
  const players = await openMaps(state);
  const oldRef = component(players, 'Select an online player').options[0].value;
  for (const overrides of [{ user: { id: targetId } }, { guildId: targetId }, { channelId: targetId },
    { message: { id: panelId } }]) {
    assert.equal((await state.router.handle(interaction('button', component(players, 'Next').custom_id, [], overrides))).flags, 64);
  }
  assert.equal(state.scans.length, 26);
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
  assert.equal((await state.onlinePlayers.scan({ context, serverId: 'map-26' })).length, 25);
  const second = await state.onlinePlayers.scanPage({ context, serverId: 'map-26', page: 2 });
  assert.equal(second.total, 26);
  assert.equal(second.page, 2);
  assert.equal(second.players.length, 1);
  state.observations.splice(20);
  const clamped = await state.onlinePlayers.scanPage({ context, serverId: 'map-26', page: 2 });
  assert.equal(clamped.page, 1);
  assert.equal(clamped.total, 20);
  await assert.rejects(state.onlinePlayers.scanPage({ context, serverId: 'map-1', page: 0 }), /page is invalid/);
});

test('cross-map refs retain server identity for identical names, exclude unverified players, and revalidate only their map', async () => {
  const eosId = 'a'.repeat(32);
  const players = createPlayerRegistry([{ eosId,discordId:targetId,displayName:'Same Name',verified:true }]);
  const scans = [];
  let now = 0, fail = false, moved = false;
  const online = createOnlinePlayerSelectionService({ players,clock:() => now,
    ark:{ listOnlinePlayers:async serverId => {
      scans.push(serverId);
      now += 1000;
      if (fail && serverId === 'map-two') throw new Error('scan unavailable');
      return [{ eosId:moved ? 'c'.repeat(32) : eosId,displayName:'Same Name' },
        { eosId:'b'.repeat(32),displayName:'Untrusted' }];
    } } });
  const context = { actorId,guildId,channelId };
  const result = await online.scanPage({ context,serverIds:['map-one','map-two'],ttlMs:100 });
  assert.equal(result.total,2);
  assert.deepEqual(result.players.map(player => player.serverId),['map-one','map-two']);
  const selected = result.players[1];
  assert.equal(online.resolve(selected.playerRef,context).serverId,'map-two');
  assert.equal(selected.expiresAt,2100);
  scans.length = 0;
  assert.equal((await online.revalidate({ playerRef:selected.playerRef,serverId:'map-two',eosId })).online,true);
  assert.deepEqual(scans,['map-two']);
  const refreshed = await online.scanPage({ context,serverIds:['map-one'],ttlMs:100 });
  moved = true;
  assert.equal((await online.revalidate({ playerRef:refreshed.players[0].playerRef,serverId:'map-one',eosId })).online,false);
  fail = true;
  moved = false;
  const partial = await online.scanPage({ context,serverIds:['map-one','map-two'] });
  assert.deepEqual(partial.unavailableServerIds,['map-two']);
  assert.deepEqual(partial.players.map(player => player.serverId),['map-one']);
  await assert.rejects(online.scanPage({ context,serverId:'map-two' }),/scan unavailable/);
  assert.equal((await online.scanPage({ context,serverIds:[] })).total,0);
});

test('partial map failures show configured names while retaining players and pagination', async () => {
  const state = setup(false, ['map-1', 'map-2']);
  const first = await openMaps(state);
  assert.match(first.content, /Unable to scan maps: Map 1, Map 2\./);
  assert.equal(component(first, 'Select an online player').options.length, 25);
  const second = await next(state, first);
  assert.match(second.content, /Unable to scan maps: Map 1, Map 2\./);
  assert.equal(component(second, 'Select an online player').options.length, 1);
});

test('long unavailable map names do not exceed Discord content limits or hide the picker', async () => {
  const unavailable = Array.from({ length: 25 }, (_, index) => `map-${index + 1}`);
  const state = setup(false, unavailable, index => `Map ${index + 1} ${'x'.repeat(250)}`);
  const first = await openMaps(state);
  assert.ok(first.content.length <= 2000);
  assert.match(first.content, /^Select a verified online player\. Unable to scan maps: Map 1 /);
  assert.match(first.content, /, and \d+ more\. — Page 1$/);
  assert.equal(component(first, 'Select an online player').options.length, 25);
  const second = await next(state, first);
  assert.ok(second.content.length <= 2000);
  assert.match(second.content, /, and \d+ more\. — Page 2$/);
  assert.equal(component(second, 'Select an online player').options.length, 1);
  const oversized = setup(false, ['map-1'], index => index === 0 ? 'x'.repeat(3000) : `Map ${index + 1}`);
  const view = await openMaps(oversized);
  assert.ok(view.content.length <= 2000);
  assert.match(view.content, /Unable to scan 1 map \(names omitted\)\./);
  assert.equal(component(view, 'Select an online player').options.length, 25);
});

test('all map failures return a safe error while single-map scans and revalidation remain fail-closed', async () => {
  const state = setup(false, Array.from({ length: 26 }, (_, index) => `map-${index + 1}`));
  const context = { actorId, guildId, channelId };
  await assert.rejects(state.onlinePlayers.scanPage({ context, serverIds:['map-1','map-2'] }),
    error => error.code === 'ONLINE_PLAYER_MAPS_UNAVAILABLE' && error.cause.message === 'transport failure');
  await assert.rejects(state.onlinePlayers.scanPage({ context, serverId:'map-1' }), /transport failure/);
  const result = await openMaps(state);
  assert.equal(result.content, 'No fulfillment maps could be scanned right now. Please try again later.');

  const player = { eosId:'a'.repeat(32), discordId:targetId, displayName:'Player', verified:true };
  let unavailable = false;
  const online = createOnlinePlayerSelectionService({ players:createPlayerRegistry([player]),
    ark:{ listOnlinePlayers:async () => {
      if (unavailable) throw new Error('transport failure');
      return [player];
    } } });
  const selection = await online.scanPage({ context, serverId:'map-1' });
  unavailable = true;
  await assert.rejects(online.revalidate({ playerRef:selection.players[0].playerRef,
    serverId:'map-1', eosId:player.eosId }), /transport failure/);
});
