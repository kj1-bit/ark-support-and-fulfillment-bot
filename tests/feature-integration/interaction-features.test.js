'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');

const identity = { id: '10000000000000001' };

function makeInteraction(commandName, subcommand, values = {}) {
  const replies = [];
  return {
    replies,
    commandName,
    user: identity,
    guildId: '10000000000000002',
    channelId: '10000000000000003',
    member: { roleIds: [] },
    deferred: false,
    replied: false,
    deferReply: async function () { this.deferred = true; },
    editReply: async payload => replies.push(payload),
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    options: {
      getSubcommand: () => subcommand,
      getString: name => values[name],
      getInteger: name => values[name]
    },
    reply: async payload => replies.push(payload),
    showModal: async modal => { this.modal = modal; }
  };
}

function makeAdapter(overrides = {}) {
  const listeners = [];
  const calls = { ticket: null, pin: null, pinMessage: null, playerName: null, logs: [] };
  const client = {
    on: (event, listener) => { if (event === 'interactionCreate') listeners.push(listener); },
    off: () => {},
    login: async () => {},
    destroy: async () => {},
    users: {
      fetch: async id => ({
        send: async content => { calls.pinMessage = { id, content }; }
      })
    }
  };
  const services = {
    authorization: { authorize() {} },
    interactionGuard: {},
    fulfillment: {},
    onlinePlayers: {},
    catalogManager: {},
    dashboardPanels: { get: async () => null, save: async () => {} },
    playerNames: {
      submit: async input => { calls.playerName = input; return { id: 'p', state: 'PENDING' }; },
      verify: async () => ({ id: 'p', state: 'VERIFIED' })
    },
    tickets: {
      connectChannels() {},
      recoverChannels: async () => {},
      create: async input => { calls.ticket = input; return { id: 't', state: 'OPEN' }; },
      claim: async () => ({ id: 't', state: 'CLAIMED' }),
      close: async () => ({ id: 't', state: 'CLOSED' }),
      reopen: async () => ({ id: 't', state: 'OPEN' })
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
    shop: { search: async () => ({ items: [] }) },
    ...overrides
  };
  const adapter = createDiscordAdapter({
    client,
    config: {
      features: { playerNames: true, tickets: true, pins: true, shop: true },
      discord: { tokenSecret: 'DISCORD_TOKEN', guildId: '10000000000000002',
        roles: { staff: '10000000000000005' },
        channels: { playerNames: '10000000000000003', requests: '10000000000000006',
          ticketLogs: '10000000000000007', ticketCategory: '10000000000000008' } }
    },
    env: { DISCORD_TOKEN: 'test-token' },
    services,
    logSink: async event => calls.logs.push(event)
  });
  return { adapter, listeners, calls };
}

async function dispatch(listeners, interaction) {
  for (const listener of listeners) await listener(interaction);
}

test('ticket creation passes the description service contract', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  const interaction = makeInteraction('ticket', 'create', { type: 'SUPPORT', description: 'Help please' });
  await dispatch(listeners, interaction);
  assert.equal(calls.ticket.description, 'Help please');
  assert.equal(Object.hasOwn(calls.ticket, 'text'), false);
  await adapter.stop();
});

test('PIN and player-name submissions have reachable private modal flows', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  const pinCommand = makeInteraction('pin', 'request');
  let pinModal;
  pinCommand.showModal = async modal => { pinModal = modal.toJSON(); };
  await dispatch(listeners, pinCommand);
  assert.equal(pinModal.custom_id, 'v2:pin:request');
  assert.equal(pinModal.components[0].components[0].custom_id, 'pin');
  const pinModalInteraction = {
    user: identity, guildId: pinCommand.guildId, channelId: pinCommand.channelId,
    member: { roleIds: [] }, isModalSubmit: () => true, isChatInputCommand: () => false,
    isButton: () => false, customId: 'v2:pin:request',
    fields: { getTextInputValue: () => '0123' }, reply: async () => {}
  };
  await dispatch(listeners, pinModalInteraction);
  assert.equal(calls.pin.pin, '0123');

  const nameCommand = makeInteraction('player-name', 'submit');
  let nameModal;
  nameCommand.showModal = async modal => { nameModal = modal.toJSON(); };
  await dispatch(listeners, nameCommand);
  assert.equal(nameModal.custom_id, 'v2:player-name:submit');
  const nameModalInteraction = {
    user: identity, guildId: nameCommand.guildId, channelId: nameCommand.channelId,
    member: { roleIds: [] }, isModalSubmit: () => true, isChatInputCommand: () => false,
    isButton: () => false, customId: 'v2:player-name:submit',
    fields: { getTextInputValue: () => 'Survivor' }, reply: async () => {}
  };
  await dispatch(listeners, nameModalInteraction);
  assert.deepEqual(calls.playerName, { discordId: identity.id, playerName: 'Survivor' });
  await adapter.stop();
});

test('approved PIN delivery privately messages the request owner without exposing the PIN in the interaction reply', async () => {
  const { adapter, listeners, calls } = makeAdapter();
  await adapter.start();
  const interaction = makeInteraction('pin', 'deliver', { 'request-id': 'PIN-1' });
  interaction.deferred = true;
  interaction.editReply = async payload => interaction.replies.push(payload);
  await dispatch(listeners, interaction);
  assert.deepEqual(calls.pinMessage, {
    id: identity.id,
    content: 'Your approved vault PIN is **0123**. Do not share it.'
  });
  assert(!JSON.stringify(interaction.replies).includes('0123'));
  await adapter.stop();
});

test('shop search renders the service results and nested DLC warning', async () => {
  const { adapter, listeners } = makeAdapter({
    shop: { search: async () => ({ results: [{ name: 'Rex', dlc: { warning: 'Requires access to Genesis.' } }] }) }
  });
  await adapter.start();
  const interaction = makeInteraction('shop-search', null, { query: 'rex', page: 1 });
  interaction.deferReply = async () => { interaction.deferred = true; };
  interaction.editReply = async payload => interaction.replies.push(payload);
  await dispatch(listeners, interaction);
  assert.match(interaction.replies[0].content, /Rex - Requires access to Genesis/);
  await adapter.stop();
});

test('async feature failures log safe metadata and reply once with a generic message', async () => {
  const secretError = new Error('private database path C:\\secret\\db.sqlite');
  const { adapter, listeners, calls } = makeAdapter({ shop: { search: async () => { throw secretError; } } });
  await adapter.start();
  const replies = [];
  const interaction = {
    ...makeInteraction('shop-search', null, { query: 'rex', page: 1 }),
    deferred: false,
    deferReply: async () => { interaction.deferred = true; },
    editReply: async payload => replies.push(payload),
    followUp: async payload => replies.push(payload)
  };
  await dispatch(listeners, interaction);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /could not be completed safely/);
  assert(!JSON.stringify(replies).includes('secret'));
  assert.equal(calls.logs[0].type, 'discord.interaction.failed');
  assert(!JSON.stringify(calls.logs).includes(secretError.message));
  await adapter.stop();
});
