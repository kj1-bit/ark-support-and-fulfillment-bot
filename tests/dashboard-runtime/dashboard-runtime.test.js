'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDashboardsFeature, requireStaffChannel } = require('../../src/features/dashboards-feature');
const { createOperationalEventService } = require('../../src/domain/dashboards/operational-event-service');
const { createDashboardService } = require('../../src/domain/dashboards/dashboard-service');

const id = n => `100000000000000${n.toString().padStart(2,'0')}`;

async function setup(t) {
  const client = new EventEmitter();
  client.isReady = () => true;
  const saved = new Map();
  const sent = [];
  const errors = [];
  let deny = false;
  const config = { discord:{ guildId:id(1),roles:{ staff:id(2) },
    channels:{ ticketLogs:id(3),pinsDashboard:id(4),fulfillmentLogs:id(5) } },features:{ pins:true } };
  const channels = new Map(Object.values(config.discord.channels).map(channelId => {
    const messages = new Map();
    const channel = {
      id:channelId,guildId:id(1),
      guild:{ roles:{ cache:new Map([[id(1),{ id:id(1),permissions:{ has:() => false } }]]) } },
      permissionsFor:() => ({ has:() => false }),
      messages:{ fetch:async key => {
        const message = messages.get(key);
        if (!message) throw Object.assign(new Error('Unknown Message'),{ code:10008 });
        return message;
      } },
      send:async payload => {
        const message = { id:`${channelId}-${sent.length}`,payload,
          edit:async body => { message.payload = body; }, remove:() => messages.delete(message.id) };
        sent.push(message);
        messages.set(message.id,message);
        return message;
      }
    };
    return [channelId,channel];
  }));
  client.channels = { fetch:async key => channels.get(key) };
  const page = (key,n) => ({ page:n,pageSize:1,total:2,
    results:[{ type:`${key === 'tickets' ? 'ticket' : key}.event`,occurredAt:1000,details:{ id:'record-1',pin:'1234' } }] });
  const context = { client,config,logSink:async event => errors.push(event),services:{
    authorization:{ authorize:() => { if (deny) throw new Error('Denied'); } },
    dashboardPanels:{ get:async key => saved.get(key),save:async row => saved.set(row.panelKey,row) },
    dashboards:{ snapshot:async (key,n) => page(key,n),
      tickets:async input => page('tickets',input.page),
      pins:async input => page('pins',input.page),
      fulfillment:async input => page('fulfillment',input.page) }
  } };
  const feature = createDashboardsFeature();
  await feature.initialize(context);
  await feature.register(context);
  await feature.start(context);
  t.after(() => feature.stop(context));
  const emit = (event,value) => Promise.all(client.listeners(event).map(listener => listener(value)));
  return { context,client,saved,sent,channels,errors,emit,deny:() => { deny = true; } };
}

test('standing dashboards restore, edit in place, and recreate deleted messages with inline logs', async t => {
  const s = await setup(t);
  assert.equal(s.sent.length,3);
  assert.equal(s.saved.size,3);
  assert.match(s.sent[0].payload.embeds[0].description,/record-1/);
  assert(!JSON.stringify(s.sent).includes('1234'));
  await s.emit('ready');
  assert.equal(s.sent.length,3);
  const deleted = s.sent[0];
  deleted.remove();
  await s.emit('messageDelete',deleted);
  assert.equal(s.sent.length,4);
  assert.notEqual(s.saved.get('tickets').messageId,deleted.id);
});

test('authorized paging updates the bound standing message, with refresh and missing-PIN buttons', async t => {
  const s = await setup(t);
  for (const [key,channelId] of [['tickets',id(3)],['pins',id(4)],['fulfillment',id(5)]]) {
    let body;
    let deferred = false;
    const interaction = {
      customId:`v2:dashboard:${key}:2`,isButton:() => true,user:{ id:id(6) },guildId:id(1),channelId,
      channel:s.channels.get(channelId),message:{ id:s.saved.get(key).messageId },member:{ roleIds:[id(2)] },
      deferUpdate:async () => { deferred = true; }, editReply:async payload => { body = payload; },
      reply:async () => assert.fail('Authorized paging should edit inline')
    };
    await s.emit('interactionCreate',interaction);
    assert(deferred);
    assert.equal(body.flags,undefined);
    assert.match(body.embeds[0].title,/page 2/);
    assert.deepEqual(body.components[0].components.slice(0,3).map(button => button.label),
      ['Previous',key === 'pins' ? 'Refresh' : 'Refresh Logs','Next']);
    if (key === 'pins') assert.equal(body.components[0].components[3].label,'Generate Missing PINs');
  }
});

test('forged panels and unauthorized staff attempts never update public messages', async t => {
  const s = await setup(t);
  const interaction = {
    customId:'v2:dashboard:tickets:1',isButton:() => true,user:{ id:id(6) },guildId:id(1),channelId:id(3),
    channel:s.channels.get(id(3)),message:{ id:'forged' },member:{ roleIds:[] },
    deferUpdate:async () => assert.fail('Invalid panel must not be acknowledged as update'),
    reply:async payload => assert.equal(payload.flags,64)
  };
  await s.emit('interactionCreate',interaction);
  s.deny();
  interaction.message.id = s.saved.get('tickets').messageId;
  await s.emit('interactionCreate',interaction);
  assert.equal(s.errors.filter(event => event.type === 'discord.interaction.failed').length,2);
});

test('inline dashboard refuses channels visible to ordinary roles', () => {
  const context = { config:{ discord:{ roles:{ staff:id(2) } } } };
  assert.throws(() => requireStaffChannel({
    guild:{ roles:{ cache:new Map([[id(1),{ id:id(1),permissions:{ has:() => false } }]]) } },
    permissionsFor:() => ({ has:() => true })
  },context),/staff-only/);
});

test('sanitized persisted events survive service restart without PIN material', async () => {
  let stored;
  const repository = {
    append:async event => (stored = JSON.parse(JSON.stringify(event)),event),
    query:async () => ({ page:1,pageSize:10,total:1,results:[stored] })
  };
  await createOperationalEventService({ repository,clock:() => 1 }).record('pin.delivered',
    { id:'r',pin:'1234',protectedPin:'sealed',eosId:'full',status:'done' });
  const restarted = createDashboardService({ events:createOperationalEventService({ repository }) });
  const text = JSON.stringify(await restarted.pins({}));
  for (const value of ['1234','sealed','full']) assert(!text.includes(value));
  assert(text.includes('done'));
});
