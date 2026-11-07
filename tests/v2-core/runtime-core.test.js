'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createServerRegistry}=require('../../src/registries/server-registry');
const {createCreatureRegistry,diffCatalogs}=require('../../src/registries/creature-registry');
const {createArkOperationService}=require('../../src/adapters/rcon/operation-service');
const {createInMemoryFulfillmentRepository}=require('../../src/domain/fulfillment/in-memory-repository');
const {createAuditLogger}=require('../../src/logging/audit-logger');
const {createFulfillmentService}=require('../../src/application/fulfillment-service');
const {STATES}=require('../../src/domain/fulfillment/state-machine');
const creature={id:'rex',name:'Rex',blueprint:'/Game/Rex.Rex',enabled:true,tameable:true,deliveryMode:'pair',supportsGender:true,saddleApplicable:true};
const catalog=v=>({version:v,creatures:[creature]});
test('registries reject duplicates, unsafe catalog data, and unallowlisted operations',()=>{assert.throws(()=>createServerRegistry([{id:'map',enabled:true,operations:['raw']}]),/Unsupported/);assert.throws(()=>createCreatureRegistry({version:'2026.1.0',creatures:[creature,creature]}),/Duplicate/);assert.throws(()=>createCreatureRegistry({version:'2026.1.0',creatures:[{...creature,blueprint:';quit'}]}),/unsafe/);});
test('server registry rejects duplicate IDs even when one entry is disabled',()=>{
  assert.throws(
    ()=>createServerRegistry([
      {id:'map-one',enabled:false,operations:['listOnlinePlayers']},
      {id:'map-one',enabled:true,operations:['listOnlinePlayers']}
    ]),
    /Duplicate server ID/
  );
});
test('catalog changes are reviewable and versioned',()=>{const a=createCreatureRegistry(catalog('2026.1.0'));const b=createCreatureRegistry({version:'2026.2.0',creatures:[{...creature,name:'Rex Prime'}]});assert.deepEqual(diffCatalogs(a,b),{added:[],removed:[],changed:['rex']});assert.notEqual(a.checksum,b.checksum);});
test('RCON service accepts named operations and keeps raw transport private',async()=>{const calls=[];const servers=createServerRegistry([{id:'map-one',name:'Map',enabled:true,operations:['fulfillApprovedCreature']}]);const service=createArkOperationService({serverRegistry:servers,transport:{execute:async x=>{calls.push(x);return {success:true};}},buildFulfillmentPlan:()=>[{command:'internal'}]});await service.fulfillApprovedCreature({serverId:'map-one'});assert.equal(calls[0].type,'fulfillApprovedCreature');assert.throws(()=>servers.get('map-one','listOnlinePlayers'),/not allowed/);});
test('repository atomically rejects duplicate request and second claim',()=>{const repo=createInMemoryFulfillmentRepository();repo.create({id:'a',idempotencyKey:'key',actorId:'actor',state:STATES.PENDING,expiresAt:100});assert.throws(()=>repo.create({id:'b',idempotencyKey:'key',state:STATES.PENDING}),/Duplicate/);repo.claim('a','actor',50);assert.throws(()=>repo.claim('a','actor',50),/Invalid fulfillment transition/);});
test('audit logger redacts sensitive fields and EOS IDs',()=>{const out=[];createAuditLogger({sink:x=>out.push(x),clock:()=>0}).write('x',{password:'secret',eosId:'0123456789abcdef0123456789abcdef'});const text=JSON.stringify(out);assert(!text.includes('secret'));assert(!text.includes('0123456789abcdef0123456789abcdef'));});
test('empty fulfillment results fail closed without reporting success',async()=>{
  const repository=createInMemoryFulfillmentRepository();
  const events=[];
  const context={
    actorId:'10000000000000004',
    guildId:'10000000000000001',
    channelId:'10000000000000003',
    messageId:'10000000000000005'
  };

  const service=createFulfillmentService({
    authorization:{
      authorize:()=>Object.freeze({allowed:true})
    },
    interactionGuard:{
      consume:()=>Object.freeze({used:true})
    },
    repository,
    creatures:{
      version:'2026.1.0',
      get:()=>creature
    },
    ark:{
      fulfillApprovedCreature:async()=>[]
    },
    audit:{
      write:(type,data)=>events.push({type,data})
    },
    clock:()=>50,
    uuid:()=>'00000000-0000-4000-8000-000000000001'
  });

  const pending=service.createPending({
    context,
    creatureId:'rex',
    serverId:'map-one',
    eosId:'0123456789abcdef0123456789abcdef',
    idempotencyKey:'empty-results-test',
    ttlMs:1000
  });

  await assert.rejects(
    ()=>service.confirm({
      context,
      token:'single-use-token',
      requestId:pending.id
    }),
    /no operation results/
  );

  assert.equal(repository.get(pending.id).state,STATES.UNCERTAIN);
  assert(events.some(event=>event.type==='fulfillment.uncertain'));
});
