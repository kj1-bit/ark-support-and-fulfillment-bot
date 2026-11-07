'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { composeRuntime, buildAuthorizationOptions } = require('../../src/composition/compose-runtime');
const { startV2 } = require('../../src/composition/start-v2');

const ids = {
  clientId: '10000000000000001', guildId: '10000000000000002',
  roleId: '10000000000000003', channelId: '10000000000000004',
  logChannelId: '10000000000000005'
};
function frozenConfig() {
  return Object.freeze({
    schemaVersion: 1,
    runtime: Object.freeze({ mode: 'mock', environment: 'test', logLevel: 'info' }),
    discord: Object.freeze({
      clientId: ids.clientId, guildId: ids.guildId, tokenSecret: 'DISCORD_TOKEN',
      roles: Object.freeze({ staff: ids.roleId, member: ids.roleId, fulfillmentModerator: ids.roleId }),
      channels: Object.freeze({ fulfillment: ids.channelId, fulfillmentLogs: ids.logChannelId })
    }),
    ark: Object.freeze({
      timeoutMs: 10000,
      servers: Object.freeze([Object.freeze({ id: 'map-one', name: 'Map One', host: '127.0.0.1', port: 27020, passwordSecret: 'ARK_PASSWORD', enabled: true, testOnly: true, operations: Object.freeze(['listOnlinePlayers','fulfillApprovedCreature']) })])
    }),
    storage: Object.freeze({ databasePath: './runtime/test.sqlite', backupPath: './runtime/backups' }),
    features: Object.freeze({ tickets: true, pins: true, playerNames: true, shop: true, fulfillment: true })
  });
}
function fakeDatabase() {
  const calls=[];
  return {
    calls,
    get: async sql => sql === 'PRAGMA quick_check' ? { quick_check: 'ok' } : null,
    all: async () => [],
    executeSql: async sql => { calls.push(sql); },
    run: async (sql,args) => { calls.push([sql,args]); return { changes: 1 }; },
    close: async () => { calls.push('close'); }
  };
}
const catalog={version:'2026.1.0',creatures:[{id:'rex',name:'Rex',aliases:[],blueprint:'/Game/Rex.Rex',enabled:true,tameable:true,deliveryMode:'pair',supportsGender:true,saddleApplicable:true}]};

test('authorization options are derived only from validated configuration',()=>{
  const result=buildAuthorizationOptions(frozenConfig());
  assert.equal(result.guildId,ids.guildId);
  assert.deepEqual(result.capabilities['fulfillment.confirm'].roleIds,[ids.roleId]);
});

test('composition checks integrity, backs up, migrates, and constructs narrow services',async()=>{
  const db=fakeDatabase(); const order=[];
  const runtime=await composeRuntime({
    config:frozenConfig(), database:db, catalog,
    transport:{execute:async()=>({success:true})},
    buildFulfillmentPlan:()=>[{command:'internal'}],
    auditSink:()=>{}, clock:()=>0,
    randomUUID:()=> '00000000-0000-4000-8000-000000000001',
    createBackup:async()=>{order.push('backup');return {sha256:'safe'};}, env:{PIN_PROTECTION_KEY:Buffer.alloc(32,7).toString('base64')}
  });
  assert.equal(runtime.schemaVersion,6);
  assert.equal(runtime.backup.sha256,'safe');
  assert.equal(order[0],'backup');
  assert(runtime.fulfillment);
  assert(!('transport' in runtime));
});

test('composition failure occurs before Discord adapter construction',async()=>{
  let discordConstructed=false; const db=fakeDatabase();
  await assert.rejects(()=>startV2({
    loadConfig:()=>frozenConfig(), openDatabase:async()=>db,
    composeRuntime:async()=>{throw new Error('migration failed');},
    createDiscordAdapter:async()=>{discordConstructed=true;return {start:async()=>{}};}
  }),/migration failed/);
  assert.equal(discordConstructed,false);
  assert(db.calls.includes('close'));
});

test('Discord receives narrow services without database or transport',async()=>{
  const db=fakeDatabase(); let received;
  const result=await startV2({
    loadConfig:()=>frozenConfig(), openDatabase:async()=>db,
    composeRuntime:async()=>({authorization:{},interactionGuard:{},fulfillment:{},audit:{}}),
    createDiscordAdapter:async input=>{received=input;return {start:async()=>{}};}
  });
  assert.deepEqual(
    Object.keys(received.services).sort(),
    [
      'audit',
      'authorization',
      'catalogManager',
      'dashboards',
      'fulfillment',
      'interactionGuard',
      'pins',
      'playerNames',
      'playerRepository',
      'players',
      'shop',
      'tickets'
    ]
  );
  assert(!('database' in received.services));
  assert(!('transport' in received.services));
  assert.equal(result.database,db);
});

test('non-frozen configuration fails before migration or external transport',async()=>{
  const db=fakeDatabase(); let transported=false;
  await assert.rejects(()=>composeRuntime({
    config:{},database:db,catalog,
    transport:{execute:async()=>{transported=true;}},
    buildFulfillmentPlan:()=>[],auditSink:()=>{}
  }),/Frozen validated configuration/);
  assert.equal(transported,false);
  assert.equal(db.calls.length,0);
});
