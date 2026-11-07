'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { defineFeature } = require('../../src/features/feature-contract');
const { createFeatureManager } = require('../../src/features/feature-manager');

function feature(name, dependencies, calls, failAt) {
  return defineFeature({
    name,
    dependencies,
    initialize: async () => { calls.push(`${name}:initialize`); if (failAt === 'initialize') throw new Error('boom'); },
    register: async () => { calls.push(`${name}:register`); },
    start: async () => { calls.push(`${name}:start`); if (failAt === 'start') throw new Error('boom'); },
    stop: async () => { calls.push(`${name}:stop`); }
  });
}

test('enabled features follow dependency and lifecycle order', async () => {
  const calls = [];
  const manager = createFeatureManager({features:[feature('base',[],calls),feature('child',['base'],calls)],enabled:{base:true,child:true},context:{}});
  await manager.initialize(); await manager.register(); await manager.start(); await manager.stop();
  assert.deepEqual(calls,['base:initialize','child:initialize','base:register','child:register','base:start','child:start','child:stop','base:stop']);
});

test('disabled features perform no lifecycle activity', async () => {
  const calls=[]; const manager=createFeatureManager({features:[feature('disabled',[],calls)],enabled:{disabled:false},context:{}});
  await manager.initialize(); await manager.register(); await manager.start(); await manager.stop();
  assert.deepEqual(calls,[]); assert.deepEqual(manager.names,[]);
});

test('missing disabled dependency and dependency cycles fail closed', () => {
  const calls=[];
  assert.throws(()=>createFeatureManager({features:[feature('child',['base'],calls),feature('base',[],calls)],enabled:{child:true,base:false},context:{}}),/requires enabled dependency/);
  assert.throws(()=>createFeatureManager({features:[feature('one',['two'],calls),feature('two',['one'],calls)],enabled:{one:true,two:true},context:{}}),/cycle/);
});

test('start failure stops already-started features in reverse order', async () => {
  const calls=[];const manager=createFeatureManager({features:[feature('one',[],calls),feature('two',['one'],calls,'start')],enabled:{one:true,two:true},context:{}});
  await manager.initialize();await manager.register();await assert.rejects(()=>manager.start(),/boom/);
  assert.deepEqual(calls.slice(-3),['one:start','two:start','one:stop']);
});

test('feature contract rejects incomplete or unstable manifests', () => {
  assert.throws(()=>defineFeature({name:'Bad Name'}),/stable lowercase/);
  assert.throws(()=>defineFeature({name:'valid-name',dependencies:[],initialize(){},register(){},start(){}}),/stop/);
});
