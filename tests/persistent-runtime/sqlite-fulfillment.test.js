'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { composeRuntime } = require('../../src/composition/compose-runtime');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createFulfillmentController } = require('../../src/adapters/discord/fulfillment-controller');
const { createDiscordRouter } = require('../../src/adapters/discord/router');
const views = require('../../src/adapters/discord/fulfillment-view');

const id = n => `100000000000000${String(n).padStart(2,'0')}`;
const actor = { actorId:id(1),guildId:id(2),channelId:id(3),messageId:id(4),roleIds:[id(5)] };
async function setup(t, outcome = 'success') {
  const database = await openSqliteDatabase(':memory:');
  t.after(() => database.close());
  const audit = [], operations = [];
  let online = true, scanFails = false;
  const config = Object.freeze({
    features:{ fulfillment:true,dashboards:true },
    discord:{ guildId:actor.guildId,roles:{ staff:id(5),fulfillmentModerator:id(5) },
      channels:{ fulfillment:actor.channelId,fulfillmentLogs:id(6),ticketLogs:id(7),pinsDashboard:id(8) } },
    ark:{ servers:[{ id:'map-one',name:'Map One',enabled:true,testOnly:true,
      host:'127.0.0.1',port:27020,passwordSecret:'UNUSED',operations:['listOnlinePlayers','fulfillApprovedCreature'] }] }
  });
  const runtime = await composeRuntime({
    config,database,randomUUID,
    catalog:{ version:'2026.1.0',creatures:[{ id:'achatina',name:'Achatina',aliases:[],
      blueprint:'/Game/Achatina.Achatina',enabled:true,tameable:true,deliveryMode:'single',
      supportsGender:false,saddleApplicable:false }] },
    transport:{ execute:async input => {
      if (input.type === 'listOnlinePlayers') {
        if (scanFails) throw new Error('private scan error');
        return online ? [{ eosId:'a'.repeat(32),displayName:'Mock Test Player' }] : [];
      }
      operations.push(input);
      if (outcome === 'uncertain') throw new Error('private RCON error');
      return { success:outcome !== 'failed' };
    } },
    buildFulfillmentPlan:() => [{ command:'test-only-operation' }],
    auditSink:event => audit.push(event)
  });
  runtime.players.addVerified({ discordId:id(9),eosId:'a'.repeat(32),
    displayName:'Mock Test Player',verified:true });
  const controller = createFulfillmentController({ services:runtime });
  const interaction = { user:{ id:actor.actorId },guildId:actor.guildId,channelId:actor.channelId,
    message:{ id:actor.messageId },member:{ roleIds:actor.roleIds } };
  async function begin() {
    const scan = await controller.scanPage(interaction,{ serverIds:['map-one'],ttlMs:120000 });
    return controller.begin(interaction,{ serverId:'map-one',playerRef:scan.players[0].playerRef,
      creatureId:'achatina',ttlMs:120000,idempotencyKey:randomUUID() });
  }
  return { runtime,controller,interaction,begin,audit,operations,
    goOffline:() => { online = false; },failScan:() => { scanFails = true; } };
}

test('real SQLite review -> confirm executes and persists a completion log, rejects mismatches and replay', async t => {
  const s = await setup(t);
  const model = await s.begin();
  for (const context of [{ ...actor,actorId:id(10) },{ ...actor,guildId:id(10) },
    { ...actor,channelId:id(10) },{ ...actor,messageId:id(10) },{ ...actor,roleIds:[] }]) {
    await assert.rejects(s.runtime.fulfillment.confirm({ context,token:model.token }));
  }
  const done = await s.controller.confirm(s.interaction,{ token:model.token });
  assert.equal(done.state,'SUCCEEDED');
  assert.equal(s.operations.length,1);
  const logs = await s.runtime.dashboards.snapshot('fulfillment',1);
  assert.equal(logs.results[0].type,'fulfillment.succeeded');
  assert.equal(logs.results[0].details.id,model.requestId);
  assert(s.audit.some(event => event.type === 'fulfillment.completed'));
  await assert.rejects(s.controller.confirm(s.interaction,{ token:model.token }),/already consumed/);
  assert.equal(s.operations.length,1);
});

test('real SQLite cancellation consumes the review token, persists its log and never executes', async t => {
  const s = await setup(t);
  const model = await s.begin();
  const canceled = await s.controller.cancel(s.interaction,{ token:model.token });
  assert.equal(canceled.state,'CANCELED');
  assert.equal(s.operations.length,0);
  assert.equal((await s.runtime.dashboards.snapshot('fulfillment',1)).results[0].type,'fulfillment.canceled');
  await assert.rejects(s.controller.confirm(s.interaction,{ token:model.token }),/already consumed/);
});

test('real SQLite catalog changes expire the review with a failure log before execution', async t => {
  const s = await setup(t);
  const model = await s.begin();
  await s.runtime.catalogManager.activate(await s.runtime.catalogManager.propose({ version:'2026.1.1',creatures:[{
    id:'achatina',name:'Achatina',aliases:[],blueprint:'/Game/Achatina.Achatina',
    enabled:true,tameable:true,deliveryMode:'single',supportsGender:false,saddleApplicable:false
  }] }));
  await assert.rejects(s.controller.confirm(s.interaction,{ token:model.token }),/Catalog version changed/);
  assert.equal((await s.runtime.repository.get(model.requestId)).state,'EXPIRED');
  assert.equal(s.operations.length,0);
  assert.equal((await s.runtime.dashboards.snapshot('fulfillment',1)).results[0].type,'fulfillment.failed');
});

test('ticket dashboard SQL filters counts and pages without deleting full audit history', async t => {
  const s = await setup(t);
  for (const type of ['ticket.created','ticket.claimed','ticket.unclaimed','ticket.closed','ticket.completed','ticket.channel_failed']) {
    await s.runtime.operationalEvents.record(type,{
      actorId:id(9),playerName:'Player',actionActorId:id(1),previousClaimantId:id(10)
    });
  }
  const page = await s.runtime.dashboards.tickets({ context:{ ...actor,channelId:id(7) },pageSize:2,page:1 });
  assert.equal(page.total,4);
  assert.equal(page.results.length,2);
  assert(page.results.every(event => ['ticket.created','ticket.claimed','ticket.unclaimed','ticket.closed'].includes(event.type)));
  const last = await s.runtime.dashboards.tickets({ context:{ ...actor,channelId:id(7) },pageSize:2,page:2 });
  assert.equal(last.results.length,2);
  const release = [...page.results,...last.results].find(event => event.type === 'ticket.unclaimed');
  assert.equal(release.details.actionActorId,id(1));
  assert.equal(release.details.previousClaimantId,id(10));
  assert.equal((await s.runtime.operationalEvents.page({ category:'ticket' })).total,6);
});

for (const outcome of ['failed','uncertain','offline','scan-error']) {
  test(`real SQLite ${outcome} fulfillment persists a failure log without leaking transport details`, async t => {
    const s = await setup(t,outcome);
    const model = await s.begin();
    if (outcome === 'offline') s.goOffline();
    if (outcome === 'scan-error') s.failScan();
    const diagnostics = [];
    const router = createDiscordRouter({ controller:s.controller,views,logSink:async event => diagnostics.push(event) });
    const i = { ...s.interaction,customId:`v2:fulfillment:confirm:${model.token}`,isButton:() => true,
      deferUpdate:async () => { i.deferred = true; },editReply:async body => body,followUp:async body => body };
    const response = await router.handle(i);
    const record = await s.runtime.repository.get(model.requestId);
    assert.equal(record.state,outcome === 'uncertain' ? 'UNCERTAIN' : 'FAILED');
    assert.equal((await s.runtime.dashboards.snapshot('fulfillment',1)).results[0].type,'fulfillment.failed');
    if (outcome !== 'failed') {
      assert.equal(response.flags,64);
      assert.equal(diagnostics[0].type,'discord.interaction.failed');
    }
    assert(!JSON.stringify({ response,diagnostics }).includes('private'));
    if (['offline','scan-error'].includes(outcome)) assert.equal(s.operations.length,0);
  });
}
