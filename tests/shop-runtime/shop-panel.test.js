'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createShopFeature } = require('../../src/features/shop-feature');
const { createCatalogSearchService } = require('../../src/domain/shop/catalog-search-service');
const actorId = '10000000000000001', guildId = '10000000000000002', channelId = '10000000000000003';
const panelId = '10000000000000004', privateId = '10000000000000005';
function interaction(kind, customId, overrides = {}) {
  const replies = [];
  const i = { replies, user: { id: actorId }, guildId, channelId, message: { id: privateId }, customId,
    isButton: () => kind === 'button', isModalSubmit: () => kind === 'modal', isChatInputCommand: () => false,
    fields: { getTextInputValue: () => 'rex' }, showModal: async modal => modal.toJSON(),
    deferReply: async payload => { i.deferred = true; i.deferPayload = payload; },
    deferUpdate: async () => { i.deferred = true; },
    editReply: async payload => ({ ...payload, id: privateId }),
    reply: async payload => { replies.push(payload); return payload; },
    followUp: async payload => { replies.push(payload); return payload; }, ...overrides };
  return i;
}
async function setup() {
  let listener;
  const catalog = { version: 'one', creatures: Array.from({ length: 12 }, (_, index) => ({
    id: `rex-${index}`, name: `Rex ${String(index).padStart(2, '0')}`, enabled: true, tameable: true,
    blueprint: '/Game/Internal', dlc: index === 0 ? { id: 'dlc', name: 'Genesis' } : null
  })) };
  const calls = [];
  const shop = createCatalogSearchService({ catalogManager: { current: () => catalog } });
  const context = { client: { on: (_, callback) => { listener = callback; }, off() {} },
    config: { features: { tickets: true }, discord: { guildId, channels: { requests: channelId } } }, logSink: async () => {},
    services: { dashboardPanels: { get: async key => key === 'requests' ? { channelId, messageId: panelId } : null },
      shop: { search: async input => { calls.push(input); return shop.search(input); } } } };
  const feature = createShopFeature();
  await feature.initialize(context);
  await feature.register(context);
  return { handle: i => listener(i), calls, stop: () => feature.stop(context) };
}
const button = (view, label) => view.components[0].components.find(item => item.label === label);
async function openSearch(handle) {
  return handle(interaction('button', 'v2:shop:search', { message: { id: panelId } }));
}
test('request-panel shop button launches exact V1 modal without creating a competing panel', async () => {
  const { handle, calls, stop } = await setup();
  const modal = await openSearch(handle);
  assert.equal(modal.title, 'Search In-Game Shop');
  assert.equal(modal.components[0].components[0].label, 'Tame or package name');
  assert.equal(calls.length, 0);
  await stop();
});
test('shop panel source requires persisted message and exact configured guild and channel', async () => {
  const { handle, stop } = await setup();
  for (const overrides of [{ message: { id: privateId } }, { guildId: actorId }, { channelId: actorId }]) {
    assert.equal(await handle(interaction('button', 'v2:shop:search', { message: { id: panelId }, ...overrides })), false);
  }
  await stop();
});
test('shop modal privately pages existing catalog with DLC warnings and safe public fields', async () => {
  const { handle, calls, stop } = await setup();
  const modal = await openSearch(handle);
  const submission = interaction('modal', modal.custom_id, { message: undefined });
  const first = await handle(submission);
  assert.equal(submission.deferPayload.flags, 64);
  assert.match(first.content, /Requires access to Genesis/);
  assert(!JSON.stringify(first).includes('blueprint'));
  assert(!JSON.stringify(first).includes('/Game/'));
  assert.equal(button(first, 'Previous').disabled, true);
  const next = await handle(interaction('button', button(first, 'Next').custom_id));
  assert.match(next.content, /Rex 10/);
  assert.equal(button(next, 'Next').disabled, true);
  await handle(interaction('button', button(next, 'Previous').custom_id));
  assert.deepEqual(calls.map(input => input.page), [1, 2, 1]);
  await stop();
});
test('shop pagination is bound to the initiating actor, guild, channel and exact private message', async () => {
  const { handle, calls, stop } = await setup();
  const modal = await openSearch(handle);
  const first = await handle(interaction('modal', modal.custom_id, { message: undefined }));
  for (const overrides of [{ user: { id: panelId } }, { guildId: panelId }, { channelId: panelId },
    { message: { id: panelId } }]) {
    const i = interaction('button', button(first, 'Next').custom_id, overrides);
    await handle(i);
    assert.equal(i.replies[0].flags, 64);
  }
  assert.equal(calls.length, 1);
  await stop();
});
test('shop modal and paging routes are single-use; cancel removes the controls', async () => {
  const { handle, calls, stop } = await setup();
  const modal = await openSearch(handle);
  const first = await handle(interaction('modal', modal.custom_id, { message: undefined }));
  await handle(interaction('modal', modal.custom_id, { message: undefined }));
  assert.equal(calls.length, 1);
  const canceled = await handle(interaction('button', button(first, 'Cancel').custom_id));
  assert.deepEqual(canceled.components, []);
  await handle(interaction('button', button(first, 'Next').custom_id));
  assert.equal(calls.length, 1);
  await stop();
});
test('Search button allows another catalog-backed private search', async () => {
  const { handle, calls, stop } = await setup();
  const modal = await openSearch(handle);
  const first = await handle(interaction('modal', modal.custom_id, { message: undefined }));
  const again = await handle(interaction('button', button(first, 'Search').custom_id));
  assert.equal(again.title, 'Search In-Game Shop');
  await handle(interaction('modal', again.custom_id));
  assert.equal(calls.length, 2);
  await stop();
});
