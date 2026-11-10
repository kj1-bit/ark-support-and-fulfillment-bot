'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout:delay } = require('node:timers/promises');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { composeRuntime } = require('../../src/composition/compose-runtime');
const { createDashboardsFeature, pagePayload } = require('../../src/features/dashboards-feature');
const { privatePinChannel } = require('../helpers/private-pin-channel');

const id = n => `1000000000000${String(n).padStart(4,'0')}`;
const requester = { actorId:id(6),guildId:id(1),channelId:id(3),roleIds:[] };
const logStaff = { actorId:id(7),guildId:id(1),channelId:id(4),roleIds:[id(2)] };
const discord = { guildId:id(1),roles:{ staff:id(2) },channels:{
  requests:id(3),ticketLogs:id(4),ticketCategory:id(5),playerNames:id(3),pinsDashboard:id(8),fulfillmentLogs:id(9)
} };

async function setup(t) {
  const database = await openSqliteDatabase(':memory:');
  let now = 100;
  const logs = [];
  const runtime = await composeRuntime({
    config:Object.freeze({ runtime:{ mode:'mock' },discord,
      features:{ tickets:true,playerNames:true,dashboards:true },
      ark:{ servers:[{ id:'unused',name:'Unused Test Server',enabled:true,testOnly:true,host:'127.0.0.1',
        port:27020,passwordSecret:'UNUSED',operations:['listOnlinePlayers','fulfillApprovedCreature'] }] } }),
    database,randomUUID,clock:() => now++,auditSink:() => {},
    catalog:{ version:'2026.1.0',creatures:[{ id:'achatina',name:'Achatina',aliases:[],
      blueprint:'/Game/Achatina.Achatina',enabled:true,tameable:true,deliveryMode:'single',
      supportsGender:false,saddleApplicable:false }] },
    transport:{ execute:async () => assert.fail('Ticket logs must not use RCON') },buildFulfillmentPlan:() => []
  });
  let nextId = 100;
  runtime.tickets.connectChannels({
    create:async () => id(nextId++),post:async () => id(nextId++),verify:async () => {},sync:async () => {}
  });
  const client = new EventEmitter();
  client.user = { id:id(90) };
  client.isReady = () => true;
  const channels = new Map([id(4),id(8),id(9)].map(channelId => {
    const messages = new Map();
    return [channelId,{
      ...privatePinChannel({ channelId,guildId:id(1),staffRoleId:id(2) }),id:channelId,guildId:id(1),
      messages:{ fetch:async messageId => {
        const message = messages.get(messageId);
        if (!message) throw Object.assign(new Error('Unknown Message'),{ code:10008 });
        return message;
      } },
      send:async body => {
        const message = { id:id(nextId++),body,edits:0,author:client.user,
          edit:async payload => { message.body = payload; message.edits += 1; } };
        messages.set(message.id,message);
        return message;
      }
    }];
  }));
  client.channels = { fetch:async channelId => channels.get(channelId) };
  const context = { client,config:{ discord,features:{ pins:false } },services:runtime,
    logSink:async event => logs.push(event) };
  let feature = createDashboardsFeature();
  async function start() {
    await feature.initialize(context);
    await feature.register(context);
    await feature.start(context);
  }
  await start();
  t.after(async () => { await feature.stop(context); await database.close(); });
  async function current() {
    const binding = await runtime.dashboardPanels.get('tickets');
    return channels.get(id(4)).messages.fetch(binding.messageId);
  }
  async function until(expected) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await current()).body.embeds[0].description === expected) return;
      await delay(20);
    }
    assert.equal((await current()).body.embeds[0].description,expected);
  }
  const snapshot = (page = 1,pageSize = 10) => runtime.dashboards.tickets({ context:logStaff,page,pageSize });
  const render = result => pagePayload({ key:'tickets',title:'Ticket logs' },result.page,result);
  return { database,runtime,current,until,snapshot,render,logs,client,context,
    record:(type,details) => runtime.operationalEvents.record(`ticket.${type}`,details),
    restart:async () => { await feature.stop(context); feature = createDashboardsFeature(); await start(); },
    stop:() => feature.stop(context)
  };
}

test('one ticket line updates automatically through all lifecycle actions, showing only latest assignment/unclaimer and correct actors', async t => {
  const s = await setup(t);
  await s.runtime.playerNames.submit({ discordId:requester.actorId,playerName:'Mud' });
  await s.runtime.playerNames.verify({
    discordId:requester.actorId,moderatorId:id(7),context:{ ...logStaff,channelId:id(3) }
  });
  const ticket = await s.runtime.tickets.create({ type:'SUPPORT',description:'Never show this',context:requester });
  const staff = actorId => ({ ...logStaff,actorId,channelId:ticket.channelId,messageId:ticket.messageId });
  const opened = `<@${id(6)}> (Mud) opened a ticket`;
  await s.until(opened + '.');
  const binding = await s.runtime.dashboardPanels.get('tickets');
  await s.runtime.dashboardPanels.save({ panelKey:'open-tickets',channelId:id(4),messageId:id(800),updatedAt:1 });
  const unclaim = actorId => s.runtime.tickets.unclaim({
    ticketId:ticket.id,context:{ ...logStaff,actorId,messageId:id(800) }
  });
  await s.runtime.tickets.claim({ ticketId:ticket.id,context:staff(id(7)) });
  await s.until(`${opened}, <@${id(7)}> claimed the ticket.`);
  await unclaim(id(8));
  await s.until(`${opened}, <@${id(8)}> unclaimed the ticket.`);
  await s.runtime.tickets.claim({ ticketId:ticket.id,context:staff(id(9)) });
  await unclaim(id(10));
  await s.until(`${opened}, <@${id(10)}> unclaimed the ticket.`);
  assert(!(await s.current()).body.embeds[0].description.includes(id(8)));
  await s.runtime.tickets.claim({ ticketId:ticket.id,context:staff(id(11)) });
  await s.runtime.tickets.complete({ ticketId:ticket.id,context:staff(id(12)) });
  await s.runtime.tickets.close({ ticketId:ticket.id,context:staff(id(13)) });
  await s.until(`${opened}, <@${id(11)}> claimed the ticket, <@${id(12)}> completed the ticket, <@${id(13)}> closed the ticket.`);
  assert.equal((await s.snapshot()).total,1);
  assert.equal((await s.snapshot()).results.length,1);
  await s.runtime.tickets.reopen({ ticketId:ticket.id,context:staff(id(14)) });
  await s.until(`${opened}, <@${id(14)}> reopened the ticket.`);
  await s.runtime.tickets.complete({ ticketId:ticket.id,context:staff(id(15)) });
  await s.runtime.tickets.claim({ ticketId:ticket.id,context:staff(id(16)) });
  await s.runtime.tickets.close({ ticketId:ticket.id,context:staff(id(17)) });
  const final = `${opened}, <@${id(14)}> reopened the ticket, <@${id(15)}> completed the ticket, <@${id(16)}> claimed the ticket, <@${id(17)}> closed the ticket.`;
  await s.until(final);
  await s.restart();
  assert.equal((await s.current()).body.embeds[0].description,final);
  assert.equal((await s.runtime.dashboardPanels.get('tickets')).messageId,binding.messageId);
  assert.deepEqual((await s.current()).body.allowedMentions,{ parse:[] });
  for (const hidden of [ticket.id,'Never show this','{','actionActorId','description']) assert(!final.includes(hidden));
  assert.deepEqual(s.logs,[]);
});

test('SQL counts and pages by ticket in newest-opened order, unaffected by later actions and tied timestamps', async t => {
  const s = await setup(t);
  for (let index = 0; index < 23; index += 1) {
    const details = { id:`hidden-${index}`,actorId:id(6),playerName:`Player ${index}`,actionActorId:id(7) };
    await s.record('created',details);
    for (const action of ['claimed','unclaimed','claimed','completed','closed']) await s.record(action,details);
  }
  const first = await s.snapshot();
  const last = await s.snapshot(3);
  assert.equal(first.total,23);
  assert.equal(first.results.length,10);
  assert.equal(last.results.length,3);
  assert.equal(first.results[0].identity.playerName,'Player 22');
  assert.equal(last.results[2].identity.playerName,'Player 0');
  await s.record('reopened',{ id:'hidden-0',actorId:id(6),playerName:'Player 0',actionActorId:id(9) });
  assert.equal((await s.snapshot()).results[0].identity.playerName,'Player 22');
  assert.equal((await s.snapshot(3)).results[2].reopened.details.actionActorId,id(9));
  const rendered = s.render(first).embeds[0].description;
  assert.equal(rendered.split('\n\n').length,10);
  assert(!rendered.includes('hidden-'));
  await s.database.run('UPDATE operational_events SET occurred_at=1');
  assert.equal((await s.snapshot()).results[0].identity.playerName,'Player 22');
});

test('three-ticket mockup shows opened-only, latest-unclaimed, and claimed/completed/closed entries as exactly three lines', async t => {
  const s = await setup(t);
  for (const [ticketId,actorId,playerName,actions] of [
    ['closed-ticket',id(21),'Echo',['created','claimed','completed','closed']],
    ['released-ticket',id(20),'River',['created','claimed','unclaimed']],
    ['opened-ticket',id(6),'Mud',['created']]
  ]) {
    for (const action of actions) {
      await s.record(action,{ id:ticketId,actorId,playerName,actionActorId:action === 'unclaimed' ? id(8) : id(7) });
    }
  }
  const body = s.render(await s.snapshot());
  assert.equal(body.embeds[0].title,'Ticket logs \u00b7 page 1');
  assert.equal(body.embeds[0].description,[
    `<@${id(6)}> (Mud) opened a ticket.`,
    `<@${id(20)}> (River) opened a ticket, <@${id(8)}> unclaimed the ticket.`,
    `<@${id(21)}> (Echo) opened a ticket, <@${id(7)}> claimed the ticket, <@${id(7)}> completed the ticket, <@${id(7)}> closed the ticket.`
  ].join('\n\n'));
  assert.deepEqual(body.components[0].components.map(button => button.label),['Previous','Refresh Logs','Next']);
  assert.equal((await s.snapshot()).total,3);
});

test('old snake-case and partial/purged histories render safely without inventing actors, grouping unidentified events together or deleting audits', async t => {
  const s = await setup(t);
  const old = { id:'legacy-hidden',actor_id:id(6),player_name:'Legacy Mud',moderator_id:id(7) };
  await s.record('created',old);
  await s.record('claimed',old);
  await s.record('completed',{ ...old,actionActorId:id(8) });
  await s.record('closed',{ ...old,actionActorId:id(9) });
  await s.database.run("DELETE FROM operational_events WHERE type='ticket.created'");
  const partial = s.render(await s.snapshot()).embeds[0].description;
  assert.equal(partial,`<@${id(6)}> (Legacy Mud): Opened (record expired), <@${id(7)}> claimed the ticket, <@${id(8)}> completed the ticket, <@${id(9)}> closed the ticket.`);
  const before = (await s.runtime.operationalEvents.page({ category:'ticket' })).total;
  await s.snapshot();
  assert.equal((await s.runtime.operationalEvents.page({ category:'ticket' })).total,before);
  await s.record('unclaimed',{ id:'partial',actorId:id(6),playerName:'Partial' });
  await s.record('created',{ actorId:id(6),playerName:'Unknown ID' });
  await s.record('closed',{ actorId:id(6),playerName:'Unknown ID' });
  const page = await s.snapshot();
  assert.equal(page.total,4,'missing ticket IDs must not conflate unrelated historical events');
  assert(s.render(page).embeds[0].description.includes('Unknown unclaimed the ticket'));
  await s.record('created',null);
  assert(s.render(await s.snapshot()).embeds[0].description.includes('Unknown (Player) opened a ticket.'));
  await s.database.run("DELETE FROM operational_events WHERE category='ticket'");
  assert.equal(s.render(await s.snapshot()).embeds[0].description,'No events recorded yet.');
});

test('reclaim/unclaim after completion stays in chronological phrase order and ten worst-case entries fit Discord limits', async t => {
  const s = await setup(t);
  const details = { id:'order',actorId:id(6),playerName:'Mud',actionActorId:id(7) };
  await s.record('created',details);
  await s.record('completed',details);
  await s.record('claimed',{ ...details,actionActorId:id(8) });
  await s.record('unclaimed',{ ...details,actionActorId:id(9) });
  assert.equal(s.render(await s.snapshot()).embeds[0].description,
    `<@${id(6)}> (Mud) opened a ticket, <@${id(7)}> completed the ticket, <@${id(9)}> unclaimed the ticket.`);
  const actor = '9'.repeat(20);
  const identity = { actorId:actor,playerName:'*'.repeat(80) };
  const action = { sequence:1,details:{ actionActorId:actor } };
  const body = s.render({ page:1,pageSize:10,total:10,results:Array.from({ length:10 },() => ({
    identity,opened:{},assignment:{ ...action,type:'ticket.unclaimed' },reopened:action,completed:action,closed:action
  })) });
  assert(body.embeds[0].description.length <= 4096);
  assert.equal(body.embeds[0].description.split('\n\n').length,10);
  assert(body.embeds[0].description.endsWith('closed the ticket.'));
  assert.deepEqual(body.allowedMentions,{ parse:[] });
});

test('shutdown cancels pending persisted-event refresh subscriptions and debounces bursts', async t => {
  const s = await setup(t);
  const message = await s.current();
  const before = message.edits;
  for (const action of ['created','claimed','completed','closed']) {
    await s.record(action,{ id:'one',actorId:id(6),playerName:'Mud',actionActorId:id(7) });
  }
  await s.until(`<@${id(6)}> (Mud) opened a ticket, <@${id(7)}> claimed the ticket, <@${id(7)}> completed the ticket, <@${id(7)}> closed the ticket.`);
  assert.equal(message.edits,before + 1);
  await s.record('reopened',{ id:'one',actorId:id(6),playerName:'Mud',actionActorId:id(7) });
  await s.stop();
  const edits = message.edits;
  await delay(200);
  await s.record('claimed',{ id:'one',actorId:id(6),playerName:'Mud',actionActorId:id(7) });
  await delay(200);
  assert.equal(message.edits,edits);
  assert.equal(s.client.eventNames().length,0);
});
