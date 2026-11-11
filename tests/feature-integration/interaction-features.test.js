'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');
const { STALE_COMMAND_MESSAGE } = require('../../src/adapters/discord/stale-command-listener');
const { ticketControls } = require('../../src/adapters/discord/ticket-channel-gateway');
const { assertUniqueCustomIds } = require('../helpers/custom-ids');

const identity = { id: '10000000000000001', username: 'survivor' };
const GUILD = '10000000000000002';
const NAMES_CHANNEL = '10000000000000003';
const REQUESTS = '10000000000000006';
const TICKET_CHANNEL = '10000000000000009';
const PIN_DASHBOARD = '10000000000000010';
const panelMessage = channelId => `${channelId}1`;

function baseInteraction(overrides = {}) {
  const replies = [];
  const interaction = {
    replies,
    user: identity,
    guildId: GUILD,
    channelId: REQUESTS,
    member: { roleIds: [] },
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    deferReply: async () => { interaction.deferred = true; },
    editReply: async payload => { replies.push(payload); return { id: '10000000000000099' }; },
    followUp: async payload => replies.push(payload),
    reply: async payload => { interaction.replied = true; replies.push(payload); },
    showModal: async modal => { interaction.modal = modal.toJSON(); },
    ...overrides
  };
  return interaction;
}

const button = (customId, overrides = {}) => baseInteraction({ customId, isButton: () => true, ...overrides });

function makeAdapter(overrides = {}) {
  const listeners = [];
  const panels = new Map();
  const calls = { tickets: [], pin: null, pinMessage: null, playerName: null, logs: [] };
  const client = {
    user: { id: '10000000000000050' },
    emit() {},
    on: (event, listener) => { if (event === 'interactionCreate') listeners.push(listener); },
    off: (event, listener) => {
      const index = listeners.indexOf(listener);
      if (event === 'interactionCreate' && index >= 0) listeners.splice(index, 1);
    },
    isReady: () => true,
    login: async () => {},
    destroy: async () => {},
    channels: {
      fetch: async id => ({
        id, guildId: GUILD,
        send: async () => ({ id: panelMessage(id) }),
        messages: { fetch: async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); } }
      })
    },
    users: {
      fetch: async id => ({
        send: async content => { calls.pinMessage = { id, content }; }
      })
    }
  };
  const ticketResult = action => async input => {
    calls.tickets.push({ action, input });
    return action === 'create'
      ? { id: 't', state: 'OPEN', channelStatus: 'ACTIVE', channelId: TICKET_CHANNEL }
      : { id: 't', state: { claim: 'CLAIMED', complete: 'COMPLETED', close: 'CLOSED', reopen: 'OPEN' }[action] };
  };
  const services = {
    authorization: { authorize() {} },
    interactionGuard: {},
    fulfillment: {},
    onlinePlayers: {},
    catalogManager: {},
    dashboardPanels: {
      get: async key => panels.get(key) || null,
      save: async record => { panels.set(record.panelKey, record); }
    },
    playerNames: {
      submit: async input => { calls.playerName = input; return { id: 'p', state: 'PENDING' }; },
      linkedName: async () => null,
      queueRestoration: async () => ({ results:[],page:1,pageSize:10,total:0 })
    },
    tickets: {
      connectChannels() {},
      subscribe:() => () => {},
      recoverChannels: async () => {},
      create: ticketResult('create'),
      claim: ticketResult('claim'),
      complete: ticketResult('complete'),
      close: ticketResult('close'),
      reopen: ticketResult('reopen')
    },
    pins: {
      request: async input => { calls.pin = input; return { id: 'pin', state: 'PENDING' }; },
      approve: async () => ({ id: 'pin', state: 'APPROVED' }),
      deliver: async input => {
        await input.deliver('0123', { actorId: identity.id });
        return { id: 'pin', state: 'DELIVERED' };
      },
      cancel: async () => ({ id: 'pin', state: 'CANCELED' })
    },
    shop: { search: async () => ({ results: [] }) },
    ...overrides
  };
  const adapter = createDiscordAdapter({
    client,
    config: {
      features: { playerNames: true, tickets: true, pins: true, shop: true },
      discord: { tokenSecret: 'DISCORD_TOKEN', guildId: GUILD,
        roles: { staff: '10000000000000005' },
        channels: { playerNames: NAMES_CHANNEL, requests: REQUESTS, pinsDashboard: PIN_DASHBOARD,
          ticketLogs: '10000000000000007', ticketCategory: '10000000000000008' } }
    },
    env: { DISCORD_TOKEN: 'test-token' },
    services,
    logSink: async event => calls.logs.push(event)
  });
  return { adapter, listeners, calls };
}

async function dispatch(listeners, interaction) {
  for (const listener of [...listeners]) await listener(interaction);
}

test('Open Request on the active request panel creates a private ticket and links its channel', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  const interaction = button('v2:request:open', { message: { id: panelMessage(REQUESTS) } });
  await dispatch(listeners, interaction);
  assert.equal(calls.tickets.length, 1);
  const { action, input } = calls.tickets[0];
  assert.equal(action, 'create');
  assert.equal(input.type, 'SUPPORT');
  assert.equal(input.username, identity.username);
  assert.equal(typeof input.description, 'string');
  assert.equal(input.context.channelId, REQUESTS);
  assert.equal(interaction.replies.at(-1).content, `Ticket created: <#${TICKET_CHANNEL}>`);

  const stale = button('v2:request:open', { message: { id: '10000000000000077' } });
  await dispatch(listeners, stale);
  assert.equal(calls.tickets.length, 1);
  assert.equal(stale.replies.length, 1);
  await adapter.stop();
});

test('ticket channel buttons claim, complete, close and reopen through the bound ticket message', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  for (const action of ['claim', 'complete', 'close', 'reopen']) {
    const interaction = button(`v2:ticket:${action}:TKT-1`, { channelId: TICKET_CHANNEL, message: { id: '10000000000000020' } });
    await dispatch(listeners, interaction);
    const call = calls.tickets.at(-1);
    assert.equal(call.action, action);
    assert.equal(call.input.ticketId, 'TKT-1');
    assert.equal(call.input.context.messageId, '10000000000000020');
    assert.equal(interaction.replies.length, 1);
  }
  await dispatch(listeners, button('v2:ticket:delete:TKT-1', { channelId: TICKET_CHANNEL, message: { id: '10000000000000020' } }));
  assert.equal(calls.tickets.length, 4);
  await adapter.stop();
});

test('ticket controls offer Claim for unclaimed active tickets, preserve completion and keep unique custom IDs', () => {
  const labels = state => ticketControls({ id: 'TKT-1', state })[0].components.map(component => component.label);
  assert.deepEqual(labels('OPEN'), ['Claim Ticket', 'Ticket Completed', 'Close Ticket']);
  assert.deepEqual(labels('CLAIMED'), ['Ticket Completed', 'Close Ticket']);
  assert.deepEqual(labels('COMPLETED'), ['Claim Ticket', 'Ticket Completed', 'Close Ticket']);
  assert.deepEqual(ticketControls({ id:'TKT-1',state:'COMPLETED',moderatorId:'10000000000000005' })[0]
    .components.map(button => button.label), ['Ticket Completed','Close Ticket']);
  assert.deepEqual(labels('CLOSED'), ['Reopen Ticket']);
  for (const state of ['OPEN', 'CLAIMED', 'COMPLETED', 'CLOSED']) {
    assertUniqueCustomIds({ components: ticketControls({ id: 'TKT-1', state }) });
  }
});

test('retired PIN modals do not submit while player-name modals still work', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  await dispatch(listeners, baseInteraction({
    channelId: NAMES_CHANNEL, isModalSubmit: () => true, customId: 'v2:pin:request',
    fields: { getTextInputValue: () => '0123' }
  }));
  assert.equal(calls.pin, null);

  const setName = button('v2:player-name:set', { channelId: NAMES_CHANNEL, message: { id: panelMessage(NAMES_CHANNEL) } });
  await dispatch(listeners, setName);
  assert.equal(setName.modal.custom_id, 'v2:player-name:submit');
  await dispatch(listeners, baseInteraction({
    channelId: NAMES_CHANNEL, isModalSubmit: () => true, customId: 'v2:player-name:submit',
    fields: { getTextInputValue: () => 'Survivor' }
  }));
  assert.deepEqual(calls.playerName, { discordId: identity.id, playerName: 'Survivor' });
  await adapter.stop();
});

test('retired custom Deliver button never sends a PIN or mutates a request', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  const interaction = button('v2:pin:deliver:PIN-1', { channelId: PIN_DASHBOARD, message: { id: '10000000000000030' } });
  await dispatch(listeners, interaction);
  assert.equal(calls.pinMessage, null);
  assert.equal(interaction.replies.length, 1);
  assert(!JSON.stringify(interaction.replies).includes('0123'));
  assert.match(interaction.replies[0].content, /retired/);
  await adapter.stop();
});

test('async feature failures log safe metadata and reply once with a generic message', async () => {
  const secretError = new Error('private database path C:\\secret\\db.sqlite');
  const { adapter, listeners, calls } = makeAdapter({
    playerNames: { submit: async () => { throw secretError; }, linkedName:async () => null,
      queueRestoration:async () => ({ results:[],page:1,pageSize:10,total:0 }) }
  });
  await adapter.start();
  const interaction = baseInteraction({
    channelId: NAMES_CHANNEL, isModalSubmit: () => true, customId: 'v2:player-name:submit',
    fields: { getTextInputValue: () => 'Survivor' }
  });
  await dispatch(listeners, interaction);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /could not be completed safely/);
  assert(!JSON.stringify(interaction.replies).includes('secret'));
  assert.equal(calls.logs.filter(event => event.type === 'discord.interaction.failed').length, 1);
  assert(!JSON.stringify(calls.logs).includes(secretError.message));
  await adapter.stop();
});

test('retired slash commands get one private panel pointer and never reach a service', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  for (const commandName of ['ticket', 'pin', 'player-name', 'player-name-verify', 'player-link', 'dino-fulfillment', 'shop-search']) {
    const interaction = baseInteraction({
      commandName, isChatInputCommand: () => true,
      options: { getSubcommand: () => 'create', getString: () => 'x', getInteger: () => 1, getUser: () => identity }
    });
    await dispatch(listeners, interaction);
    assert.deepEqual(interaction.replies, [{ content: STALE_COMMAND_MESSAGE, flags: 64 }]);
  }
  assert.equal(calls.tickets.length, 0);
  assert.equal(calls.pin, null);
  assert.equal(calls.playerName, null);
  assert.deepEqual(calls.logs.filter(event => event.type === 'discord.slash_retired').map(event => event.data.command),
    ['ticket', 'pin', 'player-name', 'player-name-verify', 'player-link', 'dino-fulfillment', 'shop-search']);
  await adapter.stop();
  assert.equal(listeners.length, 0);
});
