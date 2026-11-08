'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperationalEventService } = require('../../src/domain/dashboards/operational-event-service');
const { createDashboardService } = require('../../src/domain/dashboards/dashboard-service');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');

const channels = {
  ticketLogs: '10000000000000011',
  pinsDashboard: '10000000000000012',
  fulfillmentLogs: '10000000000000013'
};

function services(overrides = {}) {
  return {
    authorization: { authorize() {} },
    interactionGuard: { issue: async () => ({}) },
    fulfillment: { createPending: async x => x, confirm: async x => x, cancel: async x => x },
    players: { byDiscord: () => null },
    catalogManager: { current: () => ({ version: '1', creatures: [] }) },
    playerNames: { submit: async x => x, verify: async x => x },
    tickets: { create: async x => x, claim: async x => x, close: async x => x, reopen: async x => x },
    pins: { request: async x => x, approve: async x => x, deliver: async x => x, cancel: async x => x },
    shop: { search: x => x },
    dashboards: {
      tickets: async x => x,
      pins: async x => x,
      fulfillment: async x => x,
      catalog: async x => x,
      all: async x => x
    },
    dashboardPanels: { get: async () => null, save: async () => {} },
    ...overrides
  };
}

function dashboardConfig(enabled = true) {
  return {
    features: {
      fulfillment: false, playerNames: false, tickets: false, pins: false, shop: false, dashboards: enabled
    },
    discord: { tokenSecret: 'DISCORD_TOKEN', channels }
  };
}

test('dashboard service reads restart-safe repository pages', async () => {
  const calls = [];
  const events = createOperationalEventService({
    repository: {
      append: async x => x,
      query: async x => (calls.push(x), { ...x, total: 1, results: [{ id: 1 }] })
    }
  });
  const first = createDashboardService({ events });
  assert.equal((await first.tickets({ page: 1 })).results[0].id, 1);
  const restarted = createDashboardService({ events });
  assert.equal((await restarted.tickets({ page: 2 })).page, 2);
  assert.equal(calls.length, 2);
});

test('dashboard authorization is required before query delegation', async () => {
  let queried = false;
  const base = createDashboardService({ events: { page: async () => { queried = true; return {}; } } });
  const dashboards = {
    tickets(input) {
      input.authorization.authorize('dashboards.view', input.context);
      return base.tickets(input);
    }
  };
  assert.throws(
    () => dashboards.tickets({ context: {}, authorization: { authorize() { throw new Error('denied'); } } }),
    /denied/
  );
  assert.equal(queried, false);
});

test('enabled dashboards register while disabled dashboards remain inert', async () => {
  const calls = [];
  const client = {
    on: (event, listener) => calls.push(['on', event, listener]),
    off: (event, listener) => calls.push(['off', event, listener]),
    login: async () => calls.push(['login']),
    destroy: async () => calls.push(['destroy'])
  };
  const enabled = createDiscordAdapter({
    client,
    config: dashboardConfig(),
    env: { DISCORD_TOKEN: 'x' },
    services: services()
  });
  assert.deepEqual(enabled.featureNames, ['dashboards']);
  await enabled.start();
  await enabled.stop();
  assert.deepEqual(calls.map(x => x[0]), ['on', 'on', 'on', 'login', 'off', 'off', 'off', 'destroy']);

  const inert = [];
  const disabled = createDiscordAdapter({
    client: { on: () => inert.push('on'), login: async () => inert.push('login'), destroy: async () => inert.push('destroy') },
    config: dashboardConfig(false),
    env: {},
    services: {}
  });
  await disabled.start();
  assert.deepEqual(inert, []);
});

test('persistent dashboard panels are restored on ready and recreated after deletion', async () => {
  const listeners = new Map();
  const sent = [];
  const saved = new Map();
  const channelsById = new Map(Object.values(channels).map(id => {
    const messages = new Map();
    return [id, {
      messages: { fetch: async id => {
        const message = messages.get(id);
        if (!message) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        return message;
      } },
      send: async payload => {
        const message = { id: `${id}-${messages.size + 1}`, payload, edit: async value => { message.payload = value; } };
        messages.set(message.id, message);
        sent.push(message);
        return message;
      }
    }];
  }));
  const panels = {
    get: async key => saved.get(key) || null,
    save: async row => saved.set(row.panelKey, row)
  };
  const client = {
    on: (event, listener) => listeners.set(event, listener),
    off: (event, listener) => listeners.delete(event),
    channels: { fetch: async id => channelsById.get(id) },
    login: async () => {},
    destroy: async () => {}
  };
  const adapter = createDiscordAdapter({
    client,
    config: dashboardConfig(),
    env: { DISCORD_TOKEN: 'x' },
    services: services({ dashboardPanels: panels })
  });
  await adapter.start();
  await listeners.get('ready')();
  assert.equal(sent.length, 3);
  assert.equal(saved.size, 3);
  await listeners.get('ready')();
  assert.equal(sent.length, 3);
  const removed = sent[0];
  const channelId = Object.values(channels).find(id => removed.id.startsWith(id));
  channelsById.get(channelId).messages = {
    fetch: async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); }
  };
  await listeners.get('messageDelete')({ id: removed.id });
  assert.equal(sent.length, 4);
  assert.notEqual(saved.get('tickets').messageId, removed.id);
  await adapter.stop();
});

test('ticket, PIN, and fulfillment panels use one authorized paginated log interface', async () => {
  let queried;
  const response = [];
  const listeners = [];
  const dashboardServices = {
    tickets: async input => (queried = input, { page: input.page, pageSize: 1, total: 2, results: [{ type: 'ticket.closed', occurredAt: 1000, details: { id: 'T-1' } }] }),
    pins: async input => (queried = input, { page: input.page, pageSize: 1, total: 2, results: [{ type: 'pin.approved', occurredAt: 1000, details: { id: 'P-1' } }] }),
    fulfillment: async input => (queried = input, { page: input.page, pageSize: 1, total: 2, results: [{ type: 'fulfillment.succeeded', occurredAt: 1000, details: { id: 'F-1' } }] })
  };
  const client = {
    on: (event, listener) => { if (event === 'interactionCreate') listeners.push(listener); },
    off: () => {},
    login: async () => {},
    destroy: async () => {}
  };
  const adapter = createDiscordAdapter({
    client,
    config: dashboardConfig(),
    env: { DISCORD_TOKEN: 'x' },
    services: services({ dashboards: dashboardServices })
  });
  await adapter.start();
  for (const [view, id] of [['tickets', 'T-1'], ['pins', 'P-1'], ['fulfillment', 'F-1']]) {
    const interaction = {
      customId: `v2:dashboard:${view}:1`,
      user: { id: '10000000000000001' },
      guildId: '10000000000000002',
      channelId: channels.ticketLogs,
      member: { roles: { cache: new Map() } },
      isButton: () => true,
      isChatInputCommand: () => false,
      reply: async payload => response.push(payload)
    };
    for (const listener of listeners) await listener(interaction);
    const payload = response.at(-1);
    assert.match(payload.embeds[0].description, new RegExp(id));
    assert.equal(payload.components[0].components[0].label, 'Previous');
    assert.equal(payload.components[0].components[1].label, 'Next');
    assert.equal(queried.page, 1);
  }
  await adapter.stop();
});

test('sensitive details remain absent after persistence and restart query', async () => {
  let stored;
  const repository = {
    append: async event => (stored = JSON.parse(JSON.stringify(event)), event),
    query: async () => ({ page: 1, pageSize: 10, total: 1, results: [stored] })
  };
  const events = createOperationalEventService({ repository, clock: () => 1 });
  await events.record('pin.delivered', { id: 'r', pin: '1234', protectedPin: 'sealed', eosId: 'full', status: 'done' });
  const restarted = createDashboardService({ events: createOperationalEventService({ repository, clock: () => 2 }) });
  const text = JSON.stringify(await restarted.pins({}));
  for (const value of ['1234', 'sealed', 'full']) assert(!text.includes(value));
  assert(text.includes('done'));
});
