'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPlayerNamesFeature } = require('../../src/features/player-names-feature');
const { privatePinChannel } = require('../helpers/private-pin-channel');

const id = n => `1000000000000${String(n).padStart(4,'0')}`;
test('staff request panel restores separately, refreshes and redacts if privacy is lost', async t => {
  const client = new EventEmitter();
  client.user = { id:id(9) };
  client.isReady = () => true;
  const config = { discord:{ guildId:id(1),roles:{ staff:id(2) },
    channels:{ playerNames:id(3),pinsDashboard:id(4) } },ark:{ servers:[] } };
  const staff = privatePinChannel({ channelId:id(4),guildId:id(1),staffRoleId:id(2) });
  const saved = new Map(), messages = new Map(), sent = [];
  const makeChannel = channel => {
    channel.messages = { fetch:async messageId => messages.get(messageId) };
    channel.send = async payload => {
      const message = { id:id(10 + sent.length),author:client.user,payload,
        edit:async body => { message.payload = body; return message; } };
      sent.push(message);
      messages.set(message.id,message);
      return message;
    };
    return channel;
  };
  const channels = new Map([[id(3),makeChannel({ id:id(3),guildId:id(1) })],[id(4),makeChannel(staff)]]);
  client.channels = { fetch:async channelId => channels.get(channelId) };
  let requests = [{ discordId:id(6),playerName:'Joe',status:'PENDING',updatedAt:1 }];
  const queue = page => ({ page:Math.min(page,Math.max(1,Math.ceil(requests.length / 10))),
    pageSize:10,total:requests.length,results:requests.slice((page - 1) * 10,page * 10) });
  const services = { authorization:{ authorize() {} },playerNames:{ linkedName:async () => null,
    queueRestoration:async (page = 1) => queue(page),queue:async ({ page }) => queue(page) },
  dashboardPanels:{ get:async key => saved.get(key),save:async record => saved.set(record.panelKey,record) } };
  const context = { client,config,services,logSink:async () => {} };
  let feature = createPlayerNamesFeature();
  const start = async () => { await feature.initialize(context); await feature.register(context); await feature.start(context); };
  t.after(() => feature.stop(context));
  await start();
  const bound = saved.get('player-name-requests');
  const message = messages.get(bound.messageId);
  assert.equal(bound.channelId,id(4));
  assert.match(message.payload.embeds[0].description,/<@.*> said their in-game name is "Joe"/);
  assert.deepEqual(message.payload.allowedMentions,{ parse:[] });
  requests = [];
  await Promise.all(client.listeners('v2PlayerNamesChanged').map(listener => listener()));
  assert.match(message.payload.embeds[0].description,/No player name requests/);
  await feature.stop(context);
  feature = createPlayerNamesFeature();
  await start();
  assert.equal(saved.get('player-name-requests').messageId,bound.messageId);
  assert.equal(sent.length,2);
  requests = Array.from({ length:11 },(_,index) => ({
    discordId:id(100 + index),playerName:`Player ${index}`,status:'PENDING',updatedAt:index
  }));
  await Promise.all(client.listeners('v2PlayerNamesChanged').map(listener => listener()));
  const next = message.payload.components[0].components.find(button => button.label === 'Next');
  let pageBody;
  const input = { customId:next.custom_id,isButton:() => true,user:{ id:id(7) },guildId:id(1),channelId:id(4),
    member:{ roleIds:[id(2)] },message:{ id:message.id },
    deferUpdate:async () => {},editReply:async body => { pageBody = body; message.payload = body; } };
  await Promise.all(client.listeners('interactionCreate').map(listener => listener(input)));
  assert.match(pageBody.embeds[0].title,/page 2/);
  assert.match(pageBody.embeds[0].description,/Player 10/);
  staff.guild.roles.cache.set(id(8),{ id:id(8),permissions:{ has:() => false } });
  const original = staff.permissionsFor;
  staff.permissionsFor = item => item.id === id(8) ? { has:() => true } : original(item);
  await Promise.all(client.listeners('channelUpdate').map(listener => listener(null,staff)));
  assert.match(message.payload.content,/unavailable/i);
  assert.deepEqual(message.payload.embeds,[]);
  assert.deepEqual(message.payload.components,[]);
});
