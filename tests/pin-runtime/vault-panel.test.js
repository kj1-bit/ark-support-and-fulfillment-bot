'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPinsFeature, vaultPanelPayload } = require('../../src/features/pins-feature');
const { VaultPinError } = require('../../src/domain/pins/vault-pin-service');
const { privatePinChannel } = require('../helpers/private-pin-channel');

const GUILD = '10000000000000001';
const VAULT = '10000000000000002';
const DASHBOARD = '10000000000000003';
const MEMBER = '10000000000000004';
const STAFF = '10000000000000005';
const USER = '10000000000000006';

async function setup(t) {
  const client = new EventEmitter();
  client.user = { id: '10000000000000099' };
  client.isReady = () => true;
  const saved = new Map([['pins', { channelId: DASHBOARD, messageId: 'dashboard' }]]);
  const sent = [];
  const logs = [];
  const calls = [];
  const messages = new Map();
  const channel = {
    ...privatePinChannel({ channelId:DASHBOARD, guildId:GUILD, staffRoleId:STAFF }),
    messages: { fetch: async id => {
      if (!messages.has(id)) throw Object.assign(new Error('Missing'), { code:10008 });
      return messages.get(id);
    } }
  };
  client.channels = { fetch: async id => id === DASHBOARD ? channel : {
    id:VAULT, guildId:GUILD,
    messages: { fetch: async () => { throw Object.assign(new Error('Missing'), { code:10008 }); } },
    send: async body => { sent.push(body); return { id:'vault' }; }
  } };
  let fetched = 0;
  client.guilds = { fetch: async () => {
    fetched += 1;
    return { members:{ fetch: async () => new Map([
      [USER, { id:USER, user:{ bot:false }, roles:{ cache:new Set([MEMBER]) } }]
    ]) } };
  } };
  const context = {
    client, config:{ discord:{ guildId:GUILD, channels:{ vault:VAULT, pinsDashboard:DASHBOARD },
      roles:{ member:MEMBER, staff:STAFF } } },
    logSink:async event => logs.push(event),
    services:{
      dashboardPanels:{ get:async key => saved.get(key), save:async record => saved.set(record.panelKey,record) },
      vaultPins:{
        deliverOwn:async input => { calls.push('own'); await input.deliver('5820'); return { created:true }; },
        assertCanGenerate:() => {},
        generateMissing:async input => {
          calls.push(input.memberIds);
          return { eligible:1, created:1, existing:0, unverified:0, failed:0 };
        }
      },
      retiredPinControls:{ list:async () => [] },
      // Any legacy interaction calling a mutation is a regression.
      pins:new Proxy({}, { get:() => () => assert.fail('Retired mutation called') })
    }
  };
  const feature = createPinsFeature();
  await feature.initialize(context);
  await feature.register(context);
  await feature.start(context);
  t.after(() => feature.stop(context));
  const emit = (event, value) => Promise.all(client.listeners(event).map(fn => fn(value)));
  function interaction(customId, extra = {}) {
    const result = {
      customId, guildId:GUILD, channelId:VAULT, user:{ id:USER, send:async text => { result.dm = text; } },
      member:{ roleIds:[MEMBER] }, message:{ id:'vault' },
      isButton:() => true, isModalSubmit:() => false, replies:[],
      deferReply:async () => { result.deferred = true; result.ephemeral = true; },
      reply:async body => result.replies.push(body), editReply:async body => result.replies.push(body),
      ...extra
    };
    return result;
  }
  return { context, client, channel, feature, saved, sent, logs, calls, messages, emit, interaction, fetched:() => fetched };
}

test('Vault panel offers only own retrieval and explains staff visibility', async t => {
  const s = await setup(t);
  assert.equal(s.saved.get('pins-vault').messageId, 'vault');
  const body = vaultPanelPayload();
  assert.deepEqual(body.components[0].components.map(item => item.custom_id), ['v2:pin:vault']);
  assert.match(body.embeds[0].description, /private between you and staff/);
  const click = s.interaction('v2:pin:vault');
  await s.emit('interactionCreate',click);
  assert.match(click.dm, /5820/);
  assert.match(click.dm, /staff-only dashboard/);
  assert(!JSON.stringify(click.replies).includes('5820'));
  assert(!JSON.stringify(s.logs).includes('5820'));
  for (const extra of [{ message:{ id:'stale' } }, { channelId:DASHBOARD }, { guildId:'wrong' }]) {
    const stale = s.interaction('v2:pin:vault',extra);
    await s.emit('interactionCreate',stale);
    assert.match(stale.replies[0].content,/no longer active/);
  }
  assert.deepEqual(s.calls,['own']);
});

test('all stale custom buttons and submitted modals are privately retired without reading input', async t => {
  const s = await setup(t);
  for (const customId of ['v2:pin:request-open','v2:pin:approve:PIN-1','v2:pin:deliver:PIN-1','v2:pin:cancel:PIN-1','v2:pin:request']) {
    const click = s.interaction(customId,customId === 'v2:pin:request' ? {
      isButton:() => false, isModalSubmit:() => true,
      fields:{ getTextInputValue:() => assert.fail('Retired modal must not read the PIN') }
    } : {});
    await s.emit('interactionCreate',click);
    assert.match(click.replies[0].content,/retired/);
    assert.equal(click.replies[0].flags,64);
  }
  assert.equal(s.calls.length,0);
});

test('Generate Missing authorizes and binds the current private dashboard before fetching members', async t => {
  const s = await setup(t);
  const click = s.interaction('v2:pin:generate-missing',{ channelId:DASHBOARD, message:{ id:'dashboard' } });
  await s.emit('interactionCreate',click);
  assert.deepEqual(s.calls,[[USER]]);
  assert.match(click.replies[0].content,/Generated: 1/);
  assert.equal(click.dm,undefined);
  const stale = s.interaction('v2:pin:generate-missing',{ channelId:DASHBOARD, message:{ id:'old' } });
  await s.emit('interactionCreate',stale);
  assert.equal(s.fetched(),1);
  s.context.services.vaultPins.assertCanGenerate = () => { throw new Error('Denied'); };
  await s.emit('interactionCreate',click);
  assert.equal(s.fetched(),1);
});

test('DM failures remain explicit and private', async t => {
  const s = await setup(t);
  s.context.services.vaultPins.deliverOwn = async () => { throw new VaultPinError('DM_FAILED','Enable direct messages and try again.'); };
  const click = s.interaction('v2:pin:vault');
  await s.emit('interactionCreate',click);
  assert.equal(click.replies[0].content,'Enable direct messages and try again.');
});

test('startup strips only bound bot-owned historical controls without reposting or mutating rows', async t => {
  const s = await setup(t);
  const edits = [];
  s.messages.set('owned',{ author:s.client.user, edit:async body => edits.push(body) });
  s.messages.set('foreign',{ author:{ id:USER }, edit:async () => assert.fail('Foreign message edited') });
  let pages = 0;
  s.context.services.retiredPinControls.list = async input => {
    assert.equal(input.guildId,GUILD);
    assert.equal(input.channelId,DASHBOARD);
    pages += 1;
    return [
      { id:'PIN-1', channelId:DASHBOARD, messageId:'owned' },
      { id:'PIN-2', channelId:DASHBOARD, messageId:'foreign' },
      { id:'PIN-3', channelId:DASHBOARD, messageId:'gone' },
      { id:'PIN-4', channelId:VAULT, messageId:'owned' }
    ];
  };
  await s.emit('ready');
  assert.equal(pages,1);
  assert.equal(edits.length,1);
  assert.deepEqual(edits[0].components,[]);
  assert.match(edits[0].content,/not activated/);
  assert.equal(s.sent.length,2); // Only the user-facing Vault panel is restored.
  await s.emit('messageDelete',{ id:'owned' });
  assert.equal(edits.length,1);
  assert.equal(s.calls.length,0);
});

test('retired control cleanup refuses an unverifiable destination', async t => {
  const s = await setup(t);
  s.channel.permissionsFor = () => ({ has:() => true });
  s.context.services.retiredPinControls.list = () => assert.fail('Unsafe channel must not be read');
  await s.emit('ready');
  assert(s.logs.some(event => event.type === 'discord.pin.retired_controls_cleanup_failed'));
});

test('historical control retirement uses bounded stable-cursor batches and never creates missing messages', async t => {
  const s = await setup(t);
  const cursors = [];
  s.context.services.retiredPinControls.list = async input => {
    assert.equal(input.limit,100);
    cursors.push(input.after);
    return input.after === '' ? Array.from({ length:100 },(_,index) => ({
      id:`PIN-${String(index).padStart(3,'0')}`,channelId:DASHBOARD,messageId:`missing-${index}`
    })) : [{ id:'PIN-100',channelId:DASHBOARD,messageId:'missing-100' }];
  };
  await s.emit('ready');
  assert.deepEqual(cursors,['','PIN-099']);
  assert.equal(s.sent.length,2);
  assert.equal(s.calls.length,0);
});
