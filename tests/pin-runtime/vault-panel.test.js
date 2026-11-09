'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPinsFeature, moderationPayload, vaultPanelPayload } = require('../../src/features/pins-feature');
const { VaultPinError } = require('../../src/domain/pins/vault-pin-service');

const GUILD = '10000000000000001';
const VAULT = '10000000000000002';
const DASHBOARD = '10000000000000003';
const MEMBER_ROLE = '10000000000000004';
const USER = '10000000000000006';
const STAFF = '10000000000000007';

function harness(overrides = {}) {
  const listeners = {};
  const sentChannels = [];
  const logs = [];
  const dms = [];
  const saved = new Map();
  let messageSeq = 0;
  const channels = new Map([VAULT, DASHBOARD].map(id => [id, {
    id,
    guildId: GUILD,
    messages: { fetch: async messageId => { const error = new Error('Unknown Message'); error.code = 10008; void messageId; throw error; } },
    send: async payload => { const message = { id: `3000000000000000${++messageSeq}`, payload }; sentChannels.push({ channelId: id, message }); return message; }
  }]));
  const client = {
    on: (event, fn) => { (listeners[event] ||= []).push(fn); },
    off: (event, fn) => { listeners[event] = (listeners[event] || []).filter(item => item !== fn); },
    isReady: () => true,
    channels: { fetch: async id => channels.get(id) },
    users: { fetch: async id => ({ send: async content => dms.push({ id, content }) }) },
    guilds: {
      fetch: async () => ({
        members: {
          fetch: async () => new Map([
            ['a', { id: USER, user: { bot: false }, roles: { cache: new Set([MEMBER_ROLE]) } }],
            ['b', { id: '10000000000000010', user: { bot: true }, roles: { cache: new Set([MEMBER_ROLE]) } }],
            ['c', { id: '10000000000000011', user: { bot: false }, roles: { cache: new Set() } }]
          ])
        }
      })
    }
  };
  const calls = { request: [], approve: [], deliverOwn: [], generateMissing: [], attach: [] };
  const services = {
    pins: {
      request: async input => { calls.request.push(input); return { id: 'PIN-abc', actorId: USER, playerName: 'Survivor', state: 'PENDING' }; },
      approve: async input => { calls.approve.push(input); return { id: input.requestId, state: 'APPROVED' }; },
      deliver: async input => ({ id: input.requestId, state: 'DELIVERED' }),
      cancel: async input => ({ id: input.requestId, state: 'CANCELED' }),
      attachModerationMessage: async input => { calls.attach.push(input); return input; }
    },
    vaultPins: {
      deliverOwn: async input => { calls.deliverOwn.push(input); await input.deliver('5820'); return { created: true, delivered: true }; },
      assertCanGenerate: () => true,
      generateMissing: async input => { calls.generateMissing.push(input); return { eligible: 1, created: 1, existing: 0, unverified: 2, failed: 0 }; }
    },
    dashboardPanels: {
      get: async key => saved.get(key),
      save: async record => saved.set(record.panelKey, record)
    },
    ...overrides.services
  };
  const context = Object.freeze({
    client,
    config: { discord: { guildId: GUILD, channels: { vault: VAULT, pinsDashboard: DASHBOARD }, roles: { member: MEMBER_ROLE, ...overrides.roles } } },
    services,
    logSink: async event => logs.push(event)
  });
  return { context, listeners, sentChannels, logs, dms, saved, calls };
}

function buttonInteraction(customId, { channelId = VAULT, messageId, actorId = USER } = {}) {
  const replies = [];
  const interaction = {
    customId,
    guildId: GUILD,
    channelId,
    user: { id: actorId, send: async content => { interaction.dm = content; } },
    member: { roleIds: [MEMBER_ROLE] },
    message: { id: messageId, edit: async payload => { interaction.edited = payload; } },
    deferred: false,
    replied: false,
    isButton: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    deferReply: async () => { interaction.deferred = true; },
    reply: async payload => { replies.push(payload); interaction.replied = true; },
    editReply: async payload => replies.push(payload),
    showModal: async modal => { interaction.modal = modal.toJSON(); },
    replies
  };
  return interaction;
}

async function started(h) {
  const feature = createPinsFeature();
  await feature.initialize(h.context);
  await feature.register(h.context);
  await feature.start(h.context);
  const vaultMessage = h.sentChannels.find(item => item.channelId === VAULT).message;
  const dispatch = async interaction => {
    for (const listener of h.listeners.interactionCreate) await listener(interaction);
  };
  return { feature, vaultMessage, dispatch };
}

test('Vault panel uses V1 wording, persists its message, and exposes request buttons', async () => {
  const payload = vaultPanelPayload();
  assert.equal(payload.embeds[0].description.split('\n')[0], 'Click below to view or receive your Vault PIN.');
  const labels = payload.components[0].components.map(button => [button.custom_id, button.label]);
  assert.deepEqual(labels, [['v2:pin:vault', 'Get My Vault PIN'], ['v2:pin:request-open', 'Request a Custom PIN']]);
  const h = harness();
  const { feature, vaultMessage } = await started(h);
  assert.equal(h.saved.get('pins-vault').messageId, vaultMessage.id);
  await feature.stop(h.context);
});

test('Get My Vault PIN sends the PIN only by DM and replies privately without it', async () => {
  const h = harness();
  const { feature, vaultMessage, dispatch } = await started(h);
  const interaction = buttonInteraction('v2:pin:vault', { messageId: vaultMessage.id });
  await dispatch(interaction);
  assert.match(interaction.dm, /5820/);
  assert.equal(h.calls.deliverOwn[0].context.guildId, GUILD);
  assert.equal(interaction.replies.length, 1);
  assert(!JSON.stringify(interaction.replies).includes('5820'));
  assert.match(interaction.replies[0].content, /direct messages/);
  assert(!JSON.stringify(h.logs).includes('5820'));
  await feature.stop(h.context);
});

test('standing Vault buttons reject stale messages and other channels', async () => {
  const h = harness();
  const { feature, vaultMessage, dispatch } = await started(h);
  for (const interaction of [
    buttonInteraction('v2:pin:vault', { messageId: '39999999999999999' }),
    buttonInteraction('v2:pin:vault', { messageId: vaultMessage.id, channelId: DASHBOARD }),
    buttonInteraction('v2:pin:request-open', { messageId: '39999999999999999' })
  ]) {
    await dispatch(interaction);
    assert.match(interaction.replies[0].content, /no longer active/);
    assert.equal(interaction.modal, undefined);
  }
  assert.equal(h.calls.deliverOwn.length, 0);
  const open = buttonInteraction('v2:pin:request-open', { messageId: vaultMessage.id });
  await dispatch(open);
  assert.equal(open.modal.custom_id, 'v2:pin:request');
  await feature.stop(h.context);
});

test('Vault PIN service errors are reported with explicit private messages', async () => {
  const h = harness({ services: { vaultPins: {
    deliverOwn: async () => { throw new VaultPinError('DM_FAILED', 'I could not send you a direct message.'); },
    assertCanGenerate: () => true,
    generateMissing: async () => ({})
  } } });
  const { feature, vaultMessage, dispatch } = await started(h);
  const interaction = buttonInteraction('v2:pin:vault', { messageId: vaultMessage.id });
  await dispatch(interaction);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].content, 'I could not send you a direct message.');
  await feature.stop(h.context);
});

test('Generate Missing PINs targets non-bot member-role members and does not DM anyone', async () => {
  const h = harness();
  const { feature, dispatch } = await started(h);
  const interaction = buttonInteraction('v2:pin:generate-missing', { channelId: DASHBOARD, messageId: '30000000000000099', actorId: STAFF });
  await dispatch(interaction);
  assert.deepEqual(h.calls.generateMissing[0].memberIds, [USER]);
  assert.equal(h.calls.generateMissing[0].context.actorId, STAFF);
  assert.equal(h.dms.length, 0);
  assert.equal(interaction.dm, undefined);
  assert.match(interaction.replies[0].content, /Generated: 1/);
  assert.match(interaction.replies[0].content, /Skipped \(player name not verified\): 2/);

  const missingRole = harness({ roles: { member: null } });
  const second = await started(missingRole);
  const denied = buttonInteraction('v2:pin:generate-missing', { channelId: DASHBOARD, messageId: '30000000000000099', actorId: STAFF });
  await second.dispatch(denied);
  assert.match(denied.replies[0].content, /member role is not configured/);
  await second.feature.stop(missingRole.context);
  await feature.stop(h.context);
});

test('Generate Missing PINs authorizes before loading guild members', async () => {
  let fetched = false;
  const h = harness({ services: { vaultPins: {
    deliverOwn: async () => ({}),
    assertCanGenerate: () => { throw new Error('This operation is not authorized.'); },
    generateMissing: async () => ({})
  } } });
  h.context.client.guilds.fetch = async () => { fetched = true; return {}; };
  const { feature, dispatch } = await started(h);
  const interaction = buttonInteraction('v2:pin:generate-missing', { channelId: DASHBOARD, messageId: '30000000000000099' });
  await dispatch(interaction);
  assert.equal(fetched, false);
  assert.match(interaction.replies[0].content, /not authorized/);
  await feature.stop(h.context);
});

test('custom PIN requests post bound staff moderation controls without the PIN', async () => {
  const h = harness();
  const { feature, dispatch } = await started(h);
  const modal = {
    customId: 'v2:pin:request', guildId: GUILD, channelId: VAULT, user: { id: USER }, member: { roleIds: [] },
    isModalSubmit: () => true, isButton: () => false, isChatInputCommand: () => false,
    fields: { getTextInputValue: () => '0123' }, replies: [], reply: async payload => modal.replies.push(payload)
  };
  await dispatch(modal);
  const posted = h.sentChannels.find(item => item.channelId === DASHBOARD).message;
  assert(!JSON.stringify(posted.payload).includes('0123'));
  assert(!JSON.stringify(modal.replies).includes('0123'));
  assert.deepEqual(posted.payload.allowedMentions, { parse: [] });
  assert.deepEqual(posted.payload.components[0].components.map(button => button.custom_id),
    ['v2:pin:approve:PIN-abc', 'v2:pin:deliver:PIN-abc', 'v2:pin:cancel:PIN-abc']);
  assert.deepEqual(h.calls.attach[0], { requestId: 'PIN-abc', channelId: DASHBOARD, messageId: posted.id });

  const approve = buttonInteraction('v2:pin:approve:PIN-abc', { channelId: DASHBOARD, messageId: posted.id, actorId: STAFF });
  await dispatch(approve);
  assert.equal(h.calls.approve[0].requireBoundMessage, true);
  assert.equal(h.calls.approve[0].context.messageId, posted.id);
  assert.equal(approve.edited.components[0].components[1].disabled, false);
  assert.equal(approve.edited.components[0].components[0].disabled, true);

  const unknown = buttonInteraction('v2:pin:attachModerationMessage:PIN-abc', { channelId: DASHBOARD, messageId: posted.id });
  await dispatch(unknown);
  assert.equal(unknown.replies.length, 0);
  await feature.stop(h.context);
});

test('moderation payload removes controls once a request is closed', () => {
  assert.deepEqual(moderationPayload({ id: 'PIN-abc', state: 'DELIVERED' }).components, []);
});
test('startup restores outstanding moderation controls without duplicates', async () => {
  const restored = [
    { id: 'PIN-new', actorId: USER, playerName: 'A', guildId: GUILD, state: 'PENDING', moderation: null },
    { id: 'PIN-live', actorId: USER, playerName: 'B', guildId: GUILD, state: 'APPROVED', moderation: { channelId: DASHBOARD, messageId: '40000000000000001' } },
    { id: 'PIN-gone', actorId: USER, playerName: 'C', guildId: GUILD, state: 'PENDING', moderation: { channelId: DASHBOARD, messageId: '40000000000000002' } },
    { id: 'PIN-race', actorId: USER, playerName: 'D', guildId: GUILD, state: 'PENDING', moderation: null },
    { id: 'PIN-foreign', actorId: USER, playerName: 'E', guildId: '10000000000000099', state: 'PENDING', moderation: null }
  ];
  const attached = [];
  const rebound = [];
  const h = harness();
  Object.assign(h.context.services.pins, {
    outstandingModeration: async ({ guildId }) => { assert.equal(guildId, GUILD); return restored; },
    attachModerationMessage: async input => {
      if (input.requestId === 'PIN-race') throw new Error('PIN moderation message is already attached.');
      attached.push(input); return input;
    },
    rebindModerationMessage: async input => { rebound.push(input); return input; }
  });
  const dashboard = await h.context.client.channels.fetch(DASHBOARD);
  const edits = [];
  dashboard.messages.fetch = async id => {
    if (id === '40000000000000001') return { id, edit: async payload => edits.push(payload) };
    const error = new Error('Unknown Message'); error.code = 10008; throw error;
  };
  const deleted = [];
  const send = dashboard.send;
  dashboard.send = async payload => { const message = await send(payload); message.delete = async () => deleted.push(message.id); return message; };
  const { feature } = await started(h);
  const posts = h.sentChannels.filter(item => item.channelId === DASHBOARD);
  assert.equal(posts.length, 3);
  assert.deepEqual(attached.map(item => item.requestId), ['PIN-new']);
  assert.deepEqual(rebound.map(item => [item.requestId, item.previousMessageId]), [['PIN-gone', '40000000000000002']]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].components[0].components[1].disabled, false);
  assert.equal(deleted.length, 1);
  assert(!JSON.stringify(posts).includes('sealed'));
  assert.equal(h.logs.filter(event => event.type === 'discord.pin.moderation_restore_failed').length, 1);
  await feature.stop(h.context);
});

test('startup restoration pages through every outstanding request in bounded batches', async () => {
  const all = Array.from({ length: 205 }, (_, i) => ({
    id: `PIN-${String(i).padStart(4, '0')}`, actorId: USER, playerName: 'P', guildId: GUILD, state: 'PENDING', createdAt: 10, moderation: null
  }));
  const calls = [];
  const h = harness();
  h.context.services.pins.outstandingModeration = async ({ guildId, limit, after }) => {
    calls.push({ limit, after });
    assert.equal(guildId, GUILD);
    const start = after ? all.findIndex(item => item.id === after.id) + 1 : 0;
    return all.slice(start, start + limit);
  };
  const { feature } = await started(h);
  assert.deepEqual(calls.map(call => call.limit), [100, 100, 100]);
  assert.equal(calls[0].after, null);
  assert.deepEqual(calls[1].after, { createdAt: 10, id: 'PIN-0099' });
  assert.deepEqual(calls[2].after, { createdAt: 10, id: 'PIN-0199' });
  assert.equal(h.calls.attach.length, 205);
  assert.equal(h.calls.attach.at(-1).requestId, 'PIN-0204');
  await feature.stop(h.context);
});

test('live deletion reposts tracked open controls once and ignores stale or closed links', async () => {
  const h = harness();
  const state = { record: null };
  const rebound = [];
  Object.assign(h.context.services.pins, {
    outstandingModeration: async () => [],
    moderationRecord: async id => (state.record && state.record.id === id ? state.record : null),
    rebindModerationMessage: async input => {
      if (input.previousMessageId !== state.record.moderation.messageId) throw new Error('PIN moderation message is already attached.');
      rebound.push(input);
      state.record = { ...state.record, moderation: { channelId: input.channelId, messageId: input.messageId } };
      return input;
    }
  });
  const dashboard = await h.context.client.channels.fetch(DASHBOARD);
  const deleted = [];
  const send = dashboard.send;
  dashboard.send = async payload => { const message = await send(payload); message.delete = async () => deleted.push(message.id); return message; };
  const { feature, dispatch } = await started(h);
  const deleteMessage = message => Promise.all(h.listeners.messageDelete.map(fn => fn(message)));
  const modal = {
    customId: 'v2:pin:request', guildId: GUILD, channelId: VAULT, user: { id: USER }, member: { roleIds: [] },
    isModalSubmit: () => true, isButton: () => false, isChatInputCommand: () => false,
    fields: { getTextInputValue: () => '0123' }, reply: async () => {}
  };
  await dispatch(modal);
  const original = h.sentChannels.filter(item => item.channelId === DASHBOARD).at(-1).message;
  state.record = { id: 'PIN-abc', actorId: USER, playerName: 'Survivor', guildId: GUILD, state: 'PENDING', moderation: { channelId: DASHBOARD, messageId: original.id } };

  await deleteMessage({ id: '49999999999999999' });
  assert.equal(rebound.length, 0);

  await deleteMessage({ id: original.id });
  assert.equal(rebound.length, 1);
  assert.equal(rebound[0].previousMessageId, original.id);
  const replacement = h.sentChannels.filter(item => item.channelId === DASHBOARD).at(-1).message;
  assert.equal(state.record.moderation.messageId, replacement.id);
  assert(!JSON.stringify(replacement.payload).includes('0123'));

  await deleteMessage({ id: original.id });
  assert.equal(rebound.length, 1);

  state.record = { ...state.record, moderation: { channelId: DASHBOARD, messageId: '48888888888888888' } };
  const before = h.sentChannels.length;
  await deleteMessage({ id: replacement.id });
  assert.equal(h.sentChannels.length, before);

  state.record = { ...state.record, moderation: { channelId: DASHBOARD, messageId: replacement.id } };
  h.calls.attach.length = 0;
  await deleteMessage({ id: replacement.id });
  assert.equal(h.sentChannels.length, before);

  const racer = { ...state.record, moderation: { channelId: DASHBOARD, messageId: '47777777777777777' } };
  await dispatch(modal);
  const fresh = h.sentChannels.filter(item => item.channelId === DASHBOARD).at(-1).message;
  state.record = { ...racer, moderation: { channelId: DASHBOARD, messageId: fresh.id } };
  const realMod = h.context.services.pins.moderationRecord;
  h.context.services.pins.moderationRecord = async id => { const r = await realMod(id); state.record = racer; return r; };
  await deleteMessage({ id: fresh.id });
  assert.equal(deleted.length, 1);
  assert.equal(h.logs.filter(event => event.type === 'discord.pin.moderation_restore_failed').length, 1);

  state.record = null;
  h.context.services.pins.moderationRecord = realMod;
  await dispatch(modal);
  const closed = h.sentChannels.filter(item => item.channelId === DASHBOARD).at(-1).message;
  const count = h.sentChannels.length;
  await deleteMessage({ id: closed.id });
  assert.equal(h.sentChannels.length, count);
  await feature.stop(h.context);
});
