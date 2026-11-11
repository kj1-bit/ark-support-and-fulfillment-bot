'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDiscordAdapter } = require('../../src/adapters/discord/adapter');

function services() {
  return {
    authorization:{ authorize() {} },interactionGuard:{ issue:async () => ({ token:'t' }) },
    fulfillment:{ createPending:async () => ({ id:'r' }),confirm:async () => ({}) },
    players:{ byDiscord:() => null },onlinePlayers:{},
    catalogManager:{ current:() => ({ version:'1',get:() => ({ id:'rex',name:'Rex' }) }) },
    playerNames:{ submit:async x => x,linkedName:async () => null,
      queueRestoration:async () => ({ results:[],page:1,pageSize:10,total:0 }) },
    dashboardPanels:{ get:async () => null,save:async () => {} },
    tickets:{ create:async x => x,claim:async x => x,close:async x => x,reopen:async x => x,
      connectChannels() {},subscribe:() => () => {},recoverChannels:async () => {} }
  };
}

const discord = { tokenSecret:'DISCORD_TOKEN',guildId:'10000000000000001',
  roles:{ staff:'10000000000000004' },
  channels:{ requests:'10000000000000002',playerNames:'10000000000000003',pinsDashboard:'10000000000000005' } };

test('tickets start after required player-name feature and panel listeners are cleaned up', async () => {
  const client = new EventEmitter();
  let loggedIn = false;
  client.login = async () => { loggedIn = true; };
  client.destroy = async () => {};
  const adapter = createDiscordAdapter({
    client,config:{ features:{ fulfillment:false,playerNames:true,tickets:true },discord },
    env:{ DISCORD_TOKEN:'x' },services:services()
  });
  assert.deepEqual(adapter.featureNames,['player-names','tickets']);
  await adapter.start();
  assert(loggedIn);
  assert.equal(client.listenerCount('interactionCreate'),3);
  assert(client.listenerCount('ready') >= 2);
  await adapter.stop();
  assert.equal(client.eventNames().length,0);
});

test('tickets fail closed when player-name dependency is disabled', () => {
  const client = { on() {},login:async () => {},destroy:async () => {} };
  assert.throws(() => createDiscordAdapter({
    client,config:{ features:{ fulfillment:false,playerNames:false,tickets:true },discord },
    env:{ DISCORD_TOKEN:'x' },services:services()
  }),/requires enabled dependency player-names/);
});

test('disabled tickets do not appear in active features', () => {
  const client = { on() {},login:async () => {},destroy:async () => {} };
  const adapter = createDiscordAdapter({
    client,config:{ features:{ fulfillment:false,playerNames:true,tickets:false },discord },
    env:{ DISCORD_TOKEN:'x' },services:services()
  });
  assert.deepEqual(adapter.featureNames,['player-names']);
});
