'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');

function services() {
  return {
    authorization: { authorize() {} },
    interactionGuard: { issue: async () => ({ token: 't', expiresAt: 1 }) },
    fulfillment: { createPending: async () => ({ id: 'r' }), confirm: async () => ({ id: 'r', state: 'SUCCEEDED' }) },
    players: { byDiscord: () => ({ displayName: 'P', eosId: 'a'.repeat(32) }) },
    catalogManager: { current: () => ({ version: '1', get: () => ({ id: 'rex', name: 'Rex' }) }) }
  };
}

test('Discord adapter registers fulfillment through the feature manager', async () => {
  const calls = [];
  const client = {
    on: (event, listener) => calls.push(['on', event, listener]),
    off: (event, listener) => calls.push(['off', event, listener]),
    login: async token => calls.push(['login', token]),
    destroy: async () => calls.push(['destroy'])
  };
  const adapter = createDiscordAdapter({client,config:{features:{fulfillment:true},discord:{token:'secret'}},services:services()});
  assert.deepEqual(adapter.featureNames, ['fulfillment']);
  await adapter.start();
  await adapter.stop();
  assert.deepEqual(calls.map(x => x[0]), ['on', 'login', 'off', 'destroy']);
});

test('disabled features cause no listener, login, or destroy activity', async () => {
  const calls = [];
  const client = {on:()=>calls.push('on'),off:()=>calls.push('off'),login:async()=>calls.push('login'),destroy:async()=>calls.push('destroy')};
  const adapter = createDiscordAdapter({client,config:{features:{fulfillment:false},discord:{token:'secret'}},services:{}});
  assert.deepEqual(adapter.featureNames, []);
  await adapter.start();
  await adapter.stop();
  assert.deepEqual(calls, []);
});

test('login failure cleans up registered feature listener', async () => {
  const calls = [];
  const client = {
    on:(event,listener)=>calls.push(['on',event,listener]),
    off:(event,listener)=>calls.push(['off',event,listener]),
    login:async()=>{throw new Error('login failed');},
    destroy:async()=>calls.push(['destroy'])
  };
  const adapter=createDiscordAdapter({client,config:{features:{fulfillment:true},discord:{token:'secret'}},services:services()});
  await assert.rejects(()=>adapter.start(),/login failed/);
  assert.deepEqual(calls.map(x=>x[0]),['on','off']);
});

test('adapter stop is idempotent before start and after shutdown', async () => {
  const calls=[];
  const client={on:()=>{},off:()=>{},login:async()=>{},destroy:async()=>calls.push('destroy')};
  const adapter=createDiscordAdapter({client,config:{features:{fulfillment:true},discord:{token:'secret'}},services:services()});
  await adapter.stop();
  await adapter.start();
  await adapter.stop();
  await adapter.stop();
  assert.deepEqual(calls,['destroy']);
});
