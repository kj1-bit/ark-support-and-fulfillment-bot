'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDashboardsFeature, pagePayload, requireStaffChannel } = require('../../src/features/dashboards-feature');
const { createOperationalEventService } = require('../../src/domain/dashboards/operational-event-service');
const { createDashboardService } = require('../../src/domain/dashboards/dashboard-service');
const { createCreatureRegistry } = require('../../src/registries/creature-registry');
const { assertUniqueCustomIds } = require('../helpers/custom-ids');
const { privatePinChannel } = require('../helpers/private-pin-channel');

const id = n => `100000000000000${n.toString().padStart(2,'0')}`;
const creatures = createCreatureRegistry({ version:'2026.1.0',creatures:[{
  id:'achatina',name:'Achatina',blueprint:'/Game/Achatina.Achatina',enabled:true,tameable:true,
  deliveryMode:'single',supportsGender:false,saddleApplicable:false
}] });

async function setup(t) {
  const client = new EventEmitter();
  client.user = { id: id(90) };
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
      ...privatePinChannel({ channelId, guildId:id(1), staffRoleId:id(2) }),
      id:channelId,guildId:id(1),
      messages:{ fetch:async key => {
        const message = messages.get(key);
        if (!message) throw Object.assign(new Error('Unknown Message'),{ code:10008 });
        return message;
      } },
      send:async payload => {
        const message = { id:`${channelId}-${sent.length}`,payload, author:client.user,
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
    results:[key === 'tickets' ? {
      id:'record-1',occurredAt:1000,opened:{},identity:{ actorId:id(6),playerName:'Survivor' }
    } : { type:`${key}.event`,occurredAt:1000,
      details:{ id:'record-1',actorId:id(6),playerName:'Survivor',pin:'1234' } }] });
  const context = { client,config,logSink:async event => errors.push(event),services:{
    authorization:{ authorize:() => { if (deny) throw new Error('Denied'); } },
    dashboardPanels:{ get:async key => saved.get(key),save:async row => saved.set(row.panelKey,row) },
    pinDirectory:{ page:async ({ page:n }) => ({ page:n,pageSize:1,total:2,
      results:[{ userId:id(6),playerName:'Survivor',pin:'5820' }] }) },
    pinDirectoryRestoration:{ page:async n => ({ page:n,pageSize:1,total:2,
      results:[{ userId:id(6),playerName:'Survivor',pin:'5820' }] }) },
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
  const emit = (event,...values) => Promise.all(client.listeners(event).map(listener => listener(...values)));
  return { context,client,feature,saved,sent,channels,errors,emit,deny:() => { deny = true; } };
}

test('standing dashboards restore, edit in place, and recreate deleted messages with inline logs', async t => {
  const s = await setup(t);
  assert.equal(s.sent.length,3);
  for (const message of s.sent) assertUniqueCustomIds(message.payload,message.payload.embeds[0].title);
  assert.equal(s.saved.size,3);
  assert.match(s.sent[0].payload.embeds[0].description,/Survivor.*opened a ticket/);
  assert(!s.sent[0].payload.embeds[0].description.includes('record-1'));
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
      customId:`v2:dashboard:${key}:${key === 'pins' ? 'directory-next' : 'next'}:2`,isButton:() => true,user:{ id:id(6) },guildId:id(1),channelId,
      channel:s.channels.get(channelId),message:{ id:s.saved.get(key).messageId },member:{ roleIds:[id(2)] },
      deferUpdate:async () => { deferred = true; }, editReply:async payload => { body = payload; },
      reply:async () => assert.fail('Authorized paging should edit inline')
    };
    await s.emit('interactionCreate',interaction);
    assert(deferred);
    assert.equal(body.flags,undefined);
    assert.match(body.embeds[0].title,/page 2/);
    assert.deepEqual(body.components[0].components.slice(0,3).map(button => button.label),
      key === 'pins' ? ['Previous','Next','Reveal PINs Privately'] : ['Previous','Refresh Logs','Next']);
    if (key === 'pins') assert.equal(body.components[0].components[3].label,'Generate Missing PINs');
  }
});

test('forged panels and unauthorized staff attempts never update public messages', async t => {
  const s = await setup(t);
  const interaction = {
    customId:'v2:dashboard:tickets:refresh:1',isButton:() => true,user:{ id:id(6) },guildId:id(1),channelId:id(3),
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

test('inline dashboard tolerates bot integration roles but not boosters or ordinary roles', () => {
  const context = { config:{ discord:{ roles:{ staff:id(2) } } } };
  const role = (roleId,extra = {}) => ({ id:roleId,permissions:{ has:() => false },...extra });
  const channel = roles => ({
    guild:{ roles:{ cache:new Map(roles.map(item => [item.id,item])) } },
    permissionsFor:item => ({ has:() => item.id !== id(1) })
  });
  const everyone = role(id(1));
  const ownBot = role(id(12),{ managed:true,tags:{ botId:id(13) } });
  const otherBot = role(id(14),{ managed:true,tags:{ botId:id(15) } });
  const staff = role(id(2));
  requireStaffChannel(channel([everyone,staff,ownBot,otherBot]),context);
  assert.throws(() => requireStaffChannel(channel([everyone,ownBot,
    role(id(16),{ managed:true,tags:{ premiumSubscriberRole:true } })]),context),/staff-only/);
  assert.throws(() => requireStaffChannel(channel([everyone,ownBot,role(id(17))]),context),/staff-only/);
  assert.throws(() => requireStaffChannel(channel([everyone,role(id(18),{ tags:{ botId:id(15) } })]),context),/staff-only/);
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

function pinInteraction(s, action = 'directory-refresh', extra = {}) {
  const click = {
    customId:`v2:dashboard:pins:${action}:1`,isButton:() => true,user:{ id:id(6) },guildId:id(1),channelId:id(4),
    channel:s.channels.get(id(4)),message:{ id:s.saved.get('pins').messageId },member:{ roleIds:[id(2)] },replies:[],
    deferUpdate:async () => { click.deferred = true; },
    deferReply:async body => { click.deferred = true; click.deferPayload = body; },
    editReply:async body => { click.body = body; }, reply:async body => click.replies.push(body),
    followUp:async body => click.replies.push(body),
    ...extra
  };
  return click;
}

function currentPinMessage(s) {
  return s.sent.find(message => message.id === s.saved.get('pins').messageId);
}

test('PIN directory hides codes, reveals only privately, retires activity, and preserves restart/deletion binding', async t => {
  const s = await setup(t);
  const pin = currentPinMessage(s);
  assert.match(pin.payload.embeds[0].description,/Survivor/);
  assert(!JSON.stringify(pin.payload).includes('5820'));
  const refreshed = pinInteraction(s);
  await s.emit('interactionCreate',refreshed);
  assert(!JSON.stringify(refreshed.body).includes('5820'));
  const reveal = pinInteraction(s,'directory-reveal');
  await s.emit('interactionCreate',reveal);
  assert.equal(reveal.deferPayload.flags,64);
  assert.match(reveal.body.content,/\|\|5820\|\|/);
  assert(!JSON.stringify(pin.payload).includes('5820'));
  const activity = pinInteraction(s,'activity-refresh');
  await s.emit('interactionCreate',activity);
  assert.equal(activity.body,undefined);
  await s.feature.stop(s.context);
  const restarted = createDashboardsFeature();
  await restarted.initialize(s.context);
  await restarted.register(s.context);
  await restarted.start(s.context);
  t.after(() => restarted.stop(s.context));
  assert.equal(s.sent.length,3);
  assert(!JSON.stringify(pin.payload).includes('5820'));
  pin.remove();
  await s.emit('messageDelete',pin);
  assert.equal(s.sent.length,4);
  const replacement = s.sent[3];
  assert(!JSON.stringify(replacement.payload).includes('5820'));
  const stale = pinInteraction(s,'directory-refresh',{ message:{ id:pin.id } });
  await s.emit('interactionCreate',stale);
  assert.equal(stale.body,undefined);
  assert.equal(stale.replies[0].flags,64);
});

test('private PIN reveal rejects unauthorized, unsafe and stale requests without exposing codes', async t => {
  const s = await setup(t);
  for (const extra of [{ guildId:id(20) },{ channelId:id(3) },{ message:{ id:'stale' } }]) {
    const click = pinInteraction(s,'directory-reveal',extra);
    await s.emit('interactionCreate',click);
    assert.equal(click.body,undefined);
    assert(!JSON.stringify(click.replies).includes('5820'));
  }
  s.channels.get(id(4)).permissionsFor = () => ({ has:() => true });
  const unsafe = pinInteraction(s,'directory-reveal');
  await s.emit('interactionCreate',unsafe);
  assert.equal(unsafe.body,undefined);
  assert(!JSON.stringify(unsafe.replies).includes('5820'));
  s.deny();
  const denied = pinInteraction(s,'directory-reveal');
  await s.emit('interactionCreate',denied);
  assert.equal(denied.body,undefined);
  assert(!JSON.stringify(denied.replies).includes('5820'));
});

test('ticket summaries are single comma-separated lines with action actors and historical SQLite identity fields', () => {
  const details = { actor_id:id(6),player_name:'Survivor',moderator_id:id(7),
    id:'TKT-hidden',description:'unnecessary detail',state:'CLOSED',channel_id:'hidden-channel' };
  const body = pagePayload({ key:'tickets',title:'Ticket logs' },1,{ pageSize:10,total:1,
    results:[{ identity:details,opened:details,
      assignment:{ type:'ticket.unclaimed',sequence:2,details },
      completed:{ sequence:3,details:{ ...details,actionActorId:id(9) } },
      closed:{ sequence:4,details:{ ...details,actionActorId:id(8) } } }] });
  const text = body.embeds[0].description;
  assert.equal(text,`<@${id(6)}> (Survivor) opened a ticket, <@${id(7)}> unclaimed the ticket, <@${id(9)}> completed the ticket, <@${id(8)}> closed the ticket.`);
  for (const hidden of ['TKT-hidden','unnecessary','hidden-channel','CLOSED','{','ticket.completed','channel_failed']) {
    assert(!text.includes(hidden));
  }
});

test('fulfillment logs render only concise escaped summaries for every terminal outcome', () => {
  const at = 1_800_000_000_000;
  const body = pagePayload({ key:'fulfillment',title:'Dino Fulfillment Logs',creatures },1,{ pageSize:10,total:6,
    results:[
      { type:'fulfillment.succeeded',state:'SUCCEEDED',actorId:id(7),creatureId:'achatina',
        playerName:'Mud',occurredAt:at },
      { type:'fulfillment.failed',state:'FAILED',actorId:id(7),creatureId:'achatina',
        playerName:'Mud',occurredAt:at },
      { type:'fulfillment.failed',state:'PARTIAL',actorId:id(7),creatureId:'achatina',
        playerName:'Mud',occurredAt:at },
      { type:'fulfillment.failed',state:'UNCERTAIN',actorId:id(7),creatureId:'achatina',
        playerName:'Mud',occurredAt:at },
      { type:'fulfillment.failed',state:'EXPIRED',actorId:id(7),creatureId:'achatina',
        playerName:'Mud',occurredAt:at },
      { type:'fulfillment.canceled',state:'CANCELED',actorId:id(7),creatureId:'achatina',
        playerName:'Mud',occurredAt:at }
    ] });
  assert.equal(body.embeds[0].title,'Dino Fulfillment Logs · page 1');
  assert.equal(body.embeds[0].description,[
    `<@${id(7)}> spawned Achatina for Mud · <t:1800000000:R>`,
    `<@${id(7)}>'s Achatina spawn for Mud failed · <t:1800000000:R>`,
    `<@${id(7)}>'s Achatina spawn for Mud partially succeeded · <t:1800000000:R>`,
    `<@${id(7)}>'s Achatina spawn for Mud outcome is uncertain · <t:1800000000:R>`,
    `<@${id(7)}>'s Achatina spawn for Mud expired before completion · <t:1800000000:R>`,
    `<@${id(7)}> canceled Achatina for Mud · <t:1800000000:R>`
  ].join('\n\n'));
  assert.deepEqual(body.allowedMentions,{ parse:[] });
  assert.deepEqual(body.components[0].components.map(button => button.label),['Previous','Refresh Logs','Next']);

  const hostile = pagePayload({ key:'fulfillment',title:'Dino Fulfillment Logs' },1,{ pageSize:10,total:1,
    results:[{ type:'fulfillment.failed',occurredAt:at,actorId:'bad-id',creatureId:'*creature*',
      playerName:'@everyone\nspoof',details:{ id:'FUL-hidden',eosId:'secret' } }] });
  assert.equal(hostile.embeds[0].description,
    "Unknown staff's \\*creature\\* spawn for @​everyone spoof failed · <t:1800000000:R>");
  for (const hidden of ['FUL-hidden','secret','fulfillment.failed','{']) {
    assert(!hostile.embeds[0].description.includes(hidden));
  }
});

test('real creature registry keeps historical unknown and missing creatures from breaking other fulfillment rows', () => {
  const event = { type:'fulfillment.succeeded',actorId:id(7),playerName:'Mud',occurredAt:1_800_000_000_000 };
  const body = pagePayload({ key:'fulfillment',title:'Dino Fulfillment Logs',creatures },1,{
    pageSize:10,total:4,results:[
      { ...event,creatureId:'achatina' },
      { ...event,creatureId:'removedcreature' },
      { ...event },
      { ...event,creatureId:'achatina' }
    ]
  });
  assert.equal(body.embeds[0].description,[
    `<@${id(7)}> spawned Achatina for Mud · <t:1800000000:R>`,
    `<@${id(7)}> spawned removedcreature for Mud · <t:1800000000:R>`,
    `<@${id(7)}> spawned Unknown creature for Mud · <t:1800000000:R>`,
    `<@${id(7)}> spawned Achatina for Mud · <t:1800000000:R>`
  ].join('\n\n'));
  assert.deepEqual(body.allowedMentions,{ parse:[] });
});

test('catalog failures surface only on fulfillment paging and leave ticket logs rendering', async t => {
  const s = await setup(t);
  s.context.services.catalogManager = { current:() => { throw new Error('Catalog unavailable.'); } };
  const press = async (key,channelId) => {
    let body;
    await s.emit('interactionCreate',{
      customId:`v2:dashboard:${key}:refresh:1`,isButton:() => true,user:{ id:id(6) },guildId:id(1),channelId,
      channel:s.channels.get(channelId),message:{ id:s.saved.get(key).messageId },member:{ roleIds:[id(2)] },
      deferUpdate:async () => {},editReply:async payload => { body = payload; },
      reply:async () => {},followUp:async () => {}
    });
    return body;
  };
  assert.match((await press('tickets',id(3))).embeds[0].title,/Ticket/);
  const fulfillment = await press('fulfillment',id(5));
  assert(!fulfillment?.embeds?.[0]?.title?.startsWith('Dino Fulfillment Logs'));
});

test('PIN changes refresh the existing directory with no activity tab or plaintext codes', async t => {
  const s = await setup(t);
  s.context.services.pinDirectoryRestoration.page = async () => ({
    page:1,pageSize:10,total:1,results:[{ userId:id(7),playerName:'New Survivor',pin:'6782' }]
  });
  await s.emit('v2VaultPinsChanged');
  assert.equal(s.sent.length,3);
  assert.match(currentPinMessage(s).payload.embeds[0].description,/New Survivor/);
  assert(!JSON.stringify(currentPinMessage(s).payload).includes('6782'));
});

test('permission changes redact bound PIN content and never call decryption in an unsafe channel', async t => {
  const s = await setup(t);
  const pin = currentPinMessage(s);
  let reads = 0;
  s.context.services.pinDirectoryRestoration.page = async () => { reads += 1; assert.fail('Unsafe decrypt'); };
  const channel = s.channels.get(id(4));
  channel.permissionsFor = () => ({ has:() => true });
  await s.emit('channelUpdate',channel);
  assert.equal(reads,0);
  assert.deepEqual(pin.payload.embeds,[]);
  assert.deepEqual(pin.payload.components,[]);
  assert.match(pin.payload.content,/privacy/);
  assert(!JSON.stringify(s.errors).includes('5820'));
  assert(s.errors.some(event => event.type === 'discord.panel.restore_failed'));
  channel.permissionsFor = () => ({ has:() => false });
  s.context.services.pinDirectoryRestoration.page = async () => ({
    page:1,pageSize:10,total:1,results:[{ userId:id(6),playerName:'P',pin:'5820' }]
  });
  await s.emit('roleUpdate',
    { id:id(2),guild:channel.guild,permissions:{ has:() => false } },
    { id:id(2),guild:channel.guild,permissions:{ has:() => true } });
  assert.equal(pin.payload.content,null);
  assert(!JSON.stringify(pin.payload).includes('5820'));
});

test('paging checks fresh member-overwrite privacy before reads and clears a previously readable panel', async t => {
  const s = await setup(t);
  const channel = s.channels.get(id(4));
  let reads = 0;
  s.context.services.pinDirectory.page = async () => { reads += 1; assert.fail('Unsafe read'); };
  s.context.services.pinDirectoryRestoration.page = async () => { reads += 1; assert.fail('Unsafe restoration read'); };
  channel.permissionOverwrites.cache.set(id(7),{ id:id(7),type:1 });
  channel.members.set(id(7),{
    id:id(7),user:{ bot:false },roles:{ cache:new Set() },permissions:{ has:() => false }
  });
  channel.permissionsFor = item => ({ has:() => item.id === id(7) });
  const click = pinInteraction(s);
  await s.emit('interactionCreate',click);
  assert.equal(click.deferred,true);
  assert.equal(click.body,undefined);
  assert.equal(click.replies[0].flags,64);
  assert.equal(reads,0);
  assert.deepEqual(currentPinMessage(s).payload.embeds,[]);
});

test('a permission change during directory loading prevents publishing the loaded page', async t => {
  const s = await setup(t);
  const channel = s.channels.get(id(4));
  s.context.services.pinDirectory.page = async () => {
    channel.permissionsFor = () => ({ has:() => true });
    return { page:1,pageSize:10,total:1,results:[{ userId:id(6),playerName:'P',pin:'5820' }] };
  };
  const click = pinInteraction(s);
  await s.emit('interactionCreate',click);
  assert.equal(click.body,undefined);
  assert(!JSON.stringify(click.replies).includes('5820'));
  assert.deepEqual(currentPinMessage(s).payload.embeds,[]);
});

test('wrong guild/channel, stale panels and unauthorized directory paging never read PINs', async t => {
  const s = await setup(t);
  s.context.services.pinDirectory.page = () => assert.fail('Unauthorized read');
  for (const extra of [{ guildId:id(20) },{ channelId:id(3) },{ message:{ id:'stale' } }]) {
    const click = pinInteraction(s,'directory-refresh',extra);
    await s.emit('interactionCreate',click);
    assert.equal(click.body,undefined);
    assert.equal(click.replies[0].flags,64);
  }
  s.deny();
  const denied = pinInteraction(s);
  await s.emit('interactionCreate',denied);
  assert.equal(denied.body,undefined);
  assert.equal(denied.replies[0].flags,64);
});

test('startup will not overwrite a foreign saved panel and logs no PIN on unreadable page failures', async t => {
  const s = await setup(t);
  const pin = currentPinMessage(s);
  pin.author = { id:id(7) };
  s.context.services.pinDirectoryRestoration.page = () => assert.fail('Foreign bound message must not trigger decrypt');
  await s.emit('ready');
  assert(s.errors.some(event => event.type === 'discord.panel.restore_failed'));
  pin.author = s.client.user;
  s.context.services.pinDirectoryRestoration.page = async () => { throw new Error('sealed 5820'); };
  await s.emit('ready');
  assert.deepEqual(pin.payload.embeds,[]);
  assert(!JSON.stringify(s.errors).includes('5820'));
  assert(!JSON.stringify(s.errors).includes('sealed'));
});

test('a newly posted PIN panel is redacted if its binding cannot be persisted', async t => {
  const s = await setup(t);
  const pin = currentPinMessage(s);
  s.context.services.dashboardPanels.save = async record => {
    if (record.panelKey === 'pins') throw new Error('private storage failure');
  };
  pin.remove();
  await s.emit('messageDelete',pin);
  const orphan = s.sent[s.sent.length - 1];
  assert.deepEqual(orphan.payload.embeds,[]);
  assert.deepEqual(orphan.payload.components,[]);
  assert(s.errors.some(event => event.type === 'discord.panel.restore_failed'));
  assert(!JSON.stringify(s.errors).includes('private storage failure'));
});

test('a configured PIN channel move redacts the old bound message before restoring in the new private destination', async t => {
  const s = await setup(t);
  const old = currentPinMessage(s);
  await s.feature.stop(s.context);
  s.context.config.discord.channels.pinsDashboard = id(8);
  s.channels.set(id(8),{ ...s.channels.get(id(4)),id:id(8) });
  const restarted = createDashboardsFeature();
  await restarted.initialize(s.context);
  await restarted.register(s.context);
  await restarted.start(s.context);
  t.after(() => restarted.stop(s.context));
  assert.deepEqual(old.payload.embeds,[]);
  assert.equal(s.saved.get('pins').channelId,id(8));
  assert(!JSON.stringify(currentPinMessage(s).payload).includes('5820'));
});

test('permission failures redact the known binding even when the panel repository is unavailable', async t => {
  const s = await setup(t);
  const pin = currentPinMessage(s);
  s.context.services.dashboardPanels.get = async () => { throw new Error('private database path'); };
  await s.emit('channelUpdate',s.channels.get(id(4)));
  assert.deepEqual(pin.payload.embeds,[]);
  assert(!JSON.stringify(s.errors).includes('private database path'));
});

test('failed redaction reports a fixed notice without leaking Discord payload/error material', async t => {
  const s = await setup(t);
  const pin = currentPinMessage(s);
  pin.edit = async () => { throw new Error('Discord payload contained sealed 5820'); };
  s.channels.get(id(4)).permissionsFor = () => ({ has:() => true });
  await s.emit('channelUpdate',s.channels.get(id(4)));
  assert(s.errors.some(event => event.type === 'discord.panel.redaction_failed'));
  assert(!JSON.stringify(s.errors).includes('5820'));
  assert(!JSON.stringify(s.errors).includes('sealed'));
});

test('PIN paging is acknowledged before slow privacy checks and redaction, with failures only in private follow-ups', async t => {
  const s = await setup(t);
  const channel = s.channels.get(id(4));
  channel.permissionsFor = () => ({ has:() => true });
  s.context.services.pinDirectory.page = () => assert.fail('Unsafe directory must not be read');
  const click = pinInteraction(s);
  let release;
  const order = [];
  click.deferUpdate = async () => { order.push('acknowledged'); click.deferred = true; };
  const fetch = s.client.channels.fetch;
  let first = true;
  s.client.channels.fetch = async (...args) => {
    order.push('fetch');
    if (first) {
      first = false;
      return new Promise(resolve => { release = () => resolve(channel); });
    }
    return fetch(...args);
  };
  const paging = s.emit('interactionCreate',click);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order,['acknowledged','fetch']);
  assert.equal(click.deferred,true);
  assert.equal(click.replies.length,0);
  assert.equal(click.body,undefined);
  release();
  await paging;
  assert.equal(click.replies.length,1);
  assert.equal(click.replies[0].flags,64);
  assert.equal(click.body,undefined);
  assert.deepEqual(currentPinMessage(s).payload.embeds,[]);
  assert(!JSON.stringify(click.replies).includes('5820'));
});
