'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordRouter } = require('../../src/adapters/discord/router');
const { createFulfillmentController } = require('../../src/adapters/discord/fulfillment-controller');
const views = require('../../src/adapters/discord/fulfillment-view');
const { createCatalogSearchService } = require('../../src/domain/shop/catalog-search-service');

const actorId = '10000000000000001', guildId = '10000000000000002', channelId = '10000000000000003';
const privateId = '10000000000000004', panelId = '10000000000000005', targetId = '10000000000000006';
function interaction(kind, customId, values = [], overrides = {}) {
  const i = {
    user: { id: actorId }, guildId, channelId, message: { id: privateId }, customId, values,
    member: { roleIds: ['10000000000000007'] },
    isChatInputCommand: () => false, isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select', isUserSelectMenu: () => kind === 'member',
    isModalSubmit: () => kind === 'modal',
    reply: async payload => payload, followUp: async payload => payload,
    deferReply: async payload => { i.deferred = true; i.deferPayload = payload; },
    deferUpdate: async () => { i.deferred = true; },
    editReply: async payload => ({ ...payload, id: privateId }),
    showModal: async modal => modal.toJSON(),
    fields: { getTextInputValue: () => 'Rex' }, ...overrides
  };
  return i;
}
const components = view => view.components.flatMap(row => row.components);
const component = (view, label) => components(view).find(c => c.label === label || c.placeholder === label);
function setup() {
  let version = 'catalog-one';
  const creatures = Array.from({ length: 12 }, (_, i) => ({ id: `rex-${i}`, name: `Rex ${String(i).padStart(2, '0')}`,
    enabled: true, tameable: true, maps: ['map-one'] }));
  const catalog = () => ({ version, creatures, get: id => creatures.find(creature => creature.id === id) });
  const calls = { begin: [], scan: [], associate: [], verify: [], authorization: [] };
  const controller = {
    authorize: (i, capability = 'fulfillment.confirm') => { calls.authorization.push(capability); if (i.denied) throw new Error('Denied'); },
    catalog, search: createCatalogSearchService({ catalogManager: { current: catalog } }).search,
    scan: async (i, data) => { calls.scan.push(data); return [{ playerRef: 'trusted-ref', displayName: 'Survivor', trusted: true }]; },
    scanCandidates: async () => [{ playerRef: 'observed-ref', displayName: 'Online Name', trusted: false }],
    begin: async (i, data) => { calls.begin.push({ messageId: i.message.id, ...data }); return {
      notice: 'Review the verified target.', playerName: 'Survivor', creatureName: 'Rex 00',
      serverId: 'map-one', catalogVersion: version, token: 'single-use-token'
    }; },
    associate: async (i, data) => { calls.associate.push({ messageId: i.message.id, ...data }); return { displayName: 'Online Name' }; },
    verify: async (i, data) => { calls.verify.push(data); return {}; }
  };
  const router = createDiscordRouter({ controller, views, logSink: async () => {},
    panelMatches: i => i.message.id === panelId && i.guildId === guildId && i.channelId === channelId,
    playerPanelMatches: i => i.message.id === panelId && i.guildId === guildId && i.channelId === channelId,
    config: { ark: { servers: [
      { id: 'map-one', name: 'Map One', enabled: true, operations: ['listOnlinePlayers', 'fulfillApprovedCreature'] },
      { id: 'disabled', name: 'Disabled', enabled: false, operations: ['listOnlinePlayers', 'fulfillApprovedCreature'] },
      { id: 'scan-only', name: 'Scan Only', enabled: true, operations: ['listOnlinePlayers'] }
    ] } } });
  return { router, calls, setVersion: value => { version = value; } };
}
async function browse(router) {
  const i = interaction('button', 'v2:fulfillment:browse', [], { message: { id: panelId } });
  const result = await router.handle(i);
  assert.equal(i.deferPayload.flags, 64);
  return result;
}
async function chooseCreature(router, catalog) {
  const menu = component(catalog, 'Select a creature');
  return router.handle(interaction('select', menu.custom_id, [menu.options[0].value]));
}
async function chooseMap(router, creature) {
  const maps = await router.handle(interaction('button', component(creature, 'Select Online Player').custom_id));
  const menu = component(maps, 'Select a map');
  assert.deepEqual(menu.options.map(option => option.value), ['map-one']);
  return router.handle(interaction('select', menu.custom_id, ['map-one']));
}

test('standing fulfillment and player-name panels retain V1 labels', () => {
  assert.equal(views.fulfillmentPanelView().embeds[0].title, 'Dino Fulfillment');
  assert.deepEqual(components(views.fulfillmentPanelView()).map(c => c.label), ['Browse Dino Catalog', 'Search Dino']);
  assert.equal(views.playerNamesPanelView().content, 'Click below to set or update your in-game name.');
  assert(component(views.playerNamesPanelView(), 'Set My In-Game Name'));
  assert(component(views.playerNamesPanelView(), 'Verify Player Name'));
  assert(component(views.playerNamesPanelView(), 'Link Online Player'));
});
test('paged catalog -> creature -> map -> trusted online player -> danger confirmation uses exact private message', async () => {
  const { router, calls } = setup();
  const catalog = await browse(router);
  assert.equal(component(catalog, 'Previous').disabled, true);
  assert.equal(component(catalog, 'Next').disabled, false);
  const next = await router.handle(interaction('button', component(catalog, 'Next').custom_id));
  assert.match(next.content, /Page 2/);
  assert.equal(component(next, 'Next').disabled, true);
  const previous = await router.handle(interaction('button', component(next, 'Previous').custom_id));
  const creature = await chooseCreature(router, previous);
  assert(component(creature, 'Back to Catalog'));
  const players = await chooseMap(router, creature);
  const menu = component(players, 'Select an online player');
  assert.equal(menu.options[0].value, 'trusted-ref');
  const review = await router.handle(interaction('select', menu.custom_id, ['trusted-ref']));
  assert.equal(review.embeds[0].title, 'Review Dino Fulfillment');
  assert.equal(component(review, 'Confirm Spawn').style, 4);
  assert.equal(calls.begin[0].messageId, privateId);
  assert.equal(calls.begin[0].catalogVersion, 'catalog-one');
  await router.handle(interaction('select', menu.custom_id, ['trusted-ref']));
  assert.equal(calls.begin.length, 1);
});
test('catalog search is reachable from standing panel and private catalog', async () => {
  const { router } = setup();
  const modal = await router.handle(interaction('button', 'v2:fulfillment:search', [], { message: { id: panelId } }));
  assert.equal(modal.title, 'Search Dino');
  const submit = interaction('modal', modal.custom_id, [], { message: undefined });
  const catalog = await router.handle(submit);
  assert.equal(submit.deferPayload.flags, 64);
  const again = await router.handle(interaction('button', component(catalog, 'Search').custom_id));
  const query = interaction('modal', again.custom_id);
  const result = await router.handle(query);
  assert.equal(query.deferred, true);
  assert.match(result.content, /Dino Catalog/);
});
test('public panel copies and unauthorized staff do not create wizard flows', async () => {
  const { router, calls } = setup();
  assert.equal(await router.handle(interaction('button', 'v2:fulfillment:browse')), false);
  const denied = await router.handle(interaction('button', 'v2:fulfillment:browse', [], { message: { id: panelId }, denied: true }));
  assert.equal(denied.flags, 64);
  assert.equal(calls.begin.length, 0);
});
test('selection flows reject different actor, guild, channel and message before beginning', async () => {
  const { router, calls } = setup();
  const catalog = await browse(router);
  const menu = component(catalog, 'Select a creature');
  for (const overrides of [{ user: { id: targetId } }, { guildId: targetId }, { channelId: targetId },
    { message: { id: panelId } }]) {
    const result = await router.handle(interaction('select', menu.custom_id, [menu.options[0].value], overrides));
    assert.equal(result.flags, 64);
  }
  assert.equal(calls.begin.length, 0);
  const creature = await chooseCreature(router, catalog);
  const players = await chooseMap(router, creature);
  const playersMenu = component(players, 'Select an online player');
  await router.handle(interaction('select', playersMenu.custom_id, ['trusted-ref'], { message: { id: panelId } }));
  await router.handle(interaction('select', playersMenu.custom_id, ['foreign-ref']));
  assert.equal(calls.begin.length, 0);
});
test('catalog replacement invalidates selected creature before spawning', async () => {
  const { router, calls, setVersion } = setup();
  const catalog = await browse(router);
  setVersion('catalog-two');
  const result = await chooseCreature(router, catalog);
  assert.equal(result.flags, 64);
  assert.equal(calls.begin.length, 0);
});
test('back and cancel never issue a pending request', async () => {
  const { router, calls } = setup();
  const creature = await chooseCreature(router, await browse(router));
  const catalog = await router.handle(interaction('button', component(creature, 'Back to Catalog').custom_id));
  assert(component(catalog, 'Select a creature'));
  const canceled = await router.handle(interaction('button', component(catalog, 'Cancel').custom_id));
  assert.deepEqual(canceled.components, []);
  assert.equal(calls.begin.length, 0);
});
test('staff verification selects a Discord member instead of guessing identity from a name', async () => {
  const { router, calls } = setup();
  const members = await router.handle(interaction('button', 'v2:player-name:verify', [], { message: { id: panelId } }));
  const memberMenu = component(members, 'Select a Discord member');
  assert.equal(memberMenu.type, 5);
  await router.handle(interaction('member', memberMenu.custom_id, [targetId]));
  assert.deepEqual(calls.verify, [{ discordId: targetId }]);
  assert(calls.authorization.every(capability => capability === 'player-names.verify'));
});
test('staff online association selects a Discord user, enabled map and observed opaque player ref', async () => {
  const { router, calls } = setup();
  const members = await router.handle(interaction('button', 'v2:player-name:link', [], { message: { id: panelId } }));
  const maps = await router.handle(interaction('member', component(members, 'Select a Discord member').custom_id, [targetId]));
  const mapMenu = component(maps, 'Select a map');
  assert.deepEqual(mapMenu.options.map(option => option.value), ['map-one', 'scan-only']);
  const players = await router.handle(interaction('select', mapMenu.custom_id, ['map-one']));
  const menu = component(players, 'Select an online player');
  await router.handle(interaction('select', menu.custom_id, ['observed-ref']));
  assert.deepEqual(calls.associate, [{ messageId: privateId, playerRef: 'observed-ref',
    discordId: targetId, serverId: 'map-one' }]);
});
test('controller rejects stale catalog before issuing confirmation and binds issue to private wizard', async () => {
  const issued = [], pending = [];
  const services = {
    authorization: { authorize() {} },
    onlinePlayers: { resolve: () => ({ trusted: true, serverId: 'map-one', playerRef: 'trusted-ref',
      displayName: 'Survivor', eosId: 'a'.repeat(32) }) },
    catalogManager: { current: () => ({ version: 'current', get: () => ({ id: 'rex', name: 'Rex' }) }) },
    fulfillment: { createPending: async input => { pending.push(input); return { id: 'request-one' }; } },
    interactionGuard: { issue: async input => { issued.push(input); return { token: 'opaque', expiresAt: 1 }; } }
  };
  const controller = createFulfillmentController({ services });
  const i = interaction('select', '');
  await assert.rejects(controller.begin(i, { serverId: 'map-one', creatureId: 'rex', playerRef: 'trusted-ref',
    catalogVersion: 'old' }), /Catalog version/);
  assert.equal(issued.length, 0);
  await controller.begin(i, { serverId: 'map-one', creatureId: 'rex', playerRef: 'trusted-ref',
    catalogVersion: 'current', ttlMs: 120000, idempotencyKey: 'key' });
  assert.equal(pending[0].context.messageId, privateId);
  assert.equal(issued[0].messageId, privateId);
  assert.equal(issued[0].actorId, actorId);
  assert.equal(issued[0].guildId, guildId);
  assert.equal(issued[0].channelId, channelId);
  assert.equal(issued[0].action, 'fulfillment.confirm');
});
