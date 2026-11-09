'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PermissionFlagsBits, OverwriteType } = require('discord.js');
const { createPersistentPanel } = require('../../src/adapters/discord/persistent-panel');
const { requirePrivatePinChannel } = require('../../src/adapters/discord/staff-pin-channel');
const { privatePinChannel } = require('../helpers/private-pin-channel');

const GUILD = '10000000000000001';
const CHANNEL = '10000000000000002';
const STAFF = '10000000000000003';
const BOT = '10000000000000004';
const PLAYER = '10000000000000005';
const ORDINARY = '10000000000000006';
const FOREIGN = '10000000000000099';

const role = (id, permissions = [], guildId = GUILD) => ({
  id, guild:{ id:guildId }, permissions:{ has:bit => permissions.includes(bit) }
});
const member = (id, roles = [], guildId = GUILD) => ({
  id, guild:{ id:guildId }, user:{ bot:false },
  roles:{ cache:new Map(roles.map(id => [id,role(id)])) }, permissions:{ has:() => false }
});

async function setup(t, retryDelayMs = 30000, { failBindingSave = false } = {}) {
  const client = new EventEmitter();
  client.user = { id:BOT };
  client.isReady = () => true;
  const channel = privatePinChannel({ channelId:CHANNEL,guildId:GUILD,staffRoleId:STAFF });
  channel.guild.roles.cache.set(ORDINARY,role(ORDINARY));
  channel.members.set(PLAYER,member(PLAYER,[STAFF]));
  channel.permissionOverwrites.cache.set(PLAYER,{ id:PLAYER,type:OverwriteType.Member });
  const messages = new Map();
  const logs = [];
  let binding;
  let reads = 0;
  let fetches = 0;
  let edits = 0;
  let sends = 0;
  let text = 'PIN 5820';
  channel.messages = { fetch:async id => {
    if (!messages.has(id)) throw Object.assign(new Error('Missing'),{ code:10008 });
    return messages.get(id);
  } };
  channel.send = async body => {
    sends += 1;
    const message = {
      id:'bound',author:client.user,body,
      edit:async body => { edits += 1; message.body = body; }
    };
    messages.set(message.id,message);
    return message;
  };
  client.channels = { fetch:async () => { fetches += 1; return channel; } };
  const context = {
    client,config:{ discord:{ guildId:GUILD,roles:{ staff:STAFF },channels:{ pinsDashboard:CHANNEL } } },
    services:{ dashboardPanels:{ get:async () => binding,save:async value => {
      if (failBindingSave) throw new Error('Binding storage unavailable');
      binding = value;
    } } },
    logSink:async event => logs.push(event)
  };
  const panel = createPersistentPanel({
    key:'pins',channelId:CHANNEL,sensitive:true,retryDelayMs,validateChannel:requirePrivatePinChannel,
    payload:async () => { reads += 1; return { content:text,components:[],embeds:[] }; }
  });
  await panel.start(context);
  t.after(() => panel.stop(context));
  const emit = (event,...values) => Promise.all(client.listeners(event).map(fn => fn(...values)));
  return {
    client,channel,context,panel,logs,message:messages.get('bound'),emit,
    setText:value => { text = value; },reads:() => reads,fetches:() => fetches,edits:() => edits,sends:() => sends
  };
}

for (const event of ['channelUpdate','roleUpdate','roleDelete','guildMemberUpdate','guildMemberAdd','guildMemberAvailable','roleCreate']) {
  test(`privacy ${event} during a pending edit forces a coalesced recheck and final redaction`, async t => {
    const s = await setup(t);
    s.setText('PIN 6942');
    let injected = false;
    s.message.edit = async body => {
      if (!injected) {
        injected = true;
        s.channel.permissionsFor = () => ({ has:() => true });
        const args = {
          channelUpdate:[s.channel],
          roleUpdate:[role(ORDINARY),role(ORDINARY,[PermissionFlagsBits.ViewChannel])],
          roleDelete:[role(STAFF)],
          guildMemberUpdate:[member(PLAYER,[STAFF]),member(PLAYER)],
          guildMemberAdd:[member(PLAYER)],
          guildMemberAvailable:[member(PLAYER)],
          roleCreate:[role(ORDINARY,[PermissionFlagsBits.ViewChannel])]
        }[event];
        for (let i = 0; i < 3; i += 1) s.client.emit(event,...args);
        await new Promise(resolve => setImmediate(resolve));
      }
      s.message.body = body;
    };
    await s.panel.refresh(s.context);
    assert(injected);
    assert.match(s.message.body.content,/unavailable/);
    assert(!JSON.stringify(s.message.body).includes('6942'));
    assert.equal(s.reads(),2); // Initial publication + in-flight page; the unsafe rerun never decrypts.
    assert.equal(s.logs.filter(event => event.type === 'discord.panel.restore_failed').length,1);
    assert(!JSON.stringify(s.logs).includes('6942'));
  });
}

test('irrelevant guild/channel/role/member updates perform no REST fetches, decrypts or edits', async t => {
  const s = await setup(t);
  const baseline = [s.fetches(),s.reads(),s.edits()];
  await s.emit('channelUpdate',{ ...s.channel,id:FOREIGN });
  await s.emit('channelUpdate',{ ...s.channel,guildId:FOREIGN });
  await s.emit('channelUpdate',s.channel,{ ...s.channel,name:'renamed' });
  await s.emit('roleUpdate',role(ORDINARY),{ ...role(ORDINARY),name:'renamed' });
  await s.emit('roleUpdate',role(ORDINARY,[],FOREIGN),role(ORDINARY,[PermissionFlagsBits.ViewChannel],FOREIGN));
  await s.emit('roleDelete',role(ORDINARY));
  await s.emit('roleDelete',role(STAFF,[],FOREIGN));
  await s.emit('roleCreate',role(FOREIGN));
  await s.emit('roleCreate',role(ORDINARY,[PermissionFlagsBits.ViewChannel],FOREIGN));
  await s.emit('guildMemberUpdate',member(PLAYER,[STAFF]),{ ...member(PLAYER,[STAFF]),nickname:'changed' });
  await s.emit('guildMemberUpdate',member(FOREIGN),member(FOREIGN,[ORDINARY]));
  await s.emit('guildMemberUpdate',member(PLAYER,[STAFF],FOREIGN),member(PLAYER,[],FOREIGN));
  await s.emit('guildMemberAdd',member(FOREIGN));
  await s.emit('guildMemberAdd',member(PLAYER,[],FOREIGN));
  await s.emit('guildMemberAvailable',member(FOREIGN));
  await s.emit('guildMemberAvailable',member(PLAYER,[],FOREIGN));
  assert.deepEqual([s.fetches(),s.reads(),s.edits()],baseline);
});

test('real privacy updates are revalidated but unchanged PIN payloads are not edited', async t => {
  const s = await setup(t);
  await s.emit('roleUpdate',role(ORDINARY),role(ORDINARY,[PermissionFlagsBits.ViewChannel]));
  assert.equal(s.reads(),2);
  assert.equal(s.edits(),0);
  await s.emit('guildMemberUpdate',member(PLAYER,[STAFF]),member(PLAYER));
  assert.equal(s.reads(),3);
  assert.equal(s.edits(),0);
  await s.emit('guildMemberUpdate',member(FOREIGN),member(FOREIGN,[STAFF]));
  assert.equal(s.reads(),4);
  assert.equal(s.edits(),0);
  const changedChannel = { ...s.channel,permissionOverwrites:{ cache:new Map(s.channel.permissionOverwrites.cache) } };
  changedChannel.permissionOverwrites.cache.set(ORDINARY,{
    id:ORDINARY,type:OverwriteType.Role,allow:{ bitfield:0n },deny:{ bitfield:PermissionFlagsBits.ViewChannel }
  });
  await s.emit('channelUpdate',s.channel,changedChannel);
  assert.equal(s.reads(),5);
  assert.equal(s.edits(),0);
  s.setText('PIN 6942');
  await s.panel.refresh(s.context);
  assert.equal(s.edits(),1);
  await s.panel.refresh(s.context);
  assert.equal(s.edits(),1);
  assert.equal(s.message.body.content,'PIN 6942');
});

test('a transient verification failure is redacted then automatically recovered without unrelated events', async t => {
  const s = await setup(t,5);
  const fetch = s.channel.guild.roles.fetch;
  let failed = false;
  s.channel.guild.roles.fetch = async () => {
    if (!failed) { failed = true; throw new Error('Temporary REST outage'); }
    return fetch();
  };
  await s.panel.refresh(s.context);
  assert.match(s.message.body.content,/unavailable/);
  assert.equal(s.panel.matches({ message:{ id:s.message.id },guildId:GUILD,channelId:CHANNEL }),false);
  let resolveRestored;
  const restored = new Promise(resolve => { resolveRestored = resolve; });
  const edit = s.message.edit;
  s.message.edit = async body => {
    await edit(body);
    if (body.content === 'PIN 5820') resolveRestored();
  };
  let timeout;
  try {
    await Promise.race([restored,new Promise((_,reject) => {
      timeout = setTimeout(() => reject(new Error('Panel did not automatically recover')),1000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.panel.matches({ message:{ id:s.message.id },guildId:GUILD,channelId:CHANNEL }),true);
  assert.equal(s.message.body.content,'PIN 5820');
});

test('stop cancels pending recovery timers and removes all filtered privacy listeners', async t => {
  const s = await setup(t,5);
  s.channel.permissionsFor = () => ({ has:() => true });
  await s.panel.refresh(s.context);
  await s.panel.stop(s.context);
  const fetches = s.fetches();
  await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(s.fetches(),fetches);
  for (const event of ['channelUpdate','roleUpdate','roleDelete','roleCreate','guildMemberUpdate','guildMemberAdd','guildMemberAvailable']) {
    assert.equal(s.client.listenerCount(event),0);
  }
});

test('departed overwrite members do not disable the panel, but rejoining non-staff viewers trigger redaction', async t => {
  const s = await setup(t);
  let joined = false;
  s.channel.guild.members.fetch = async () => {
    if (!joined) throw Object.assign(new Error('Unknown Member'),{ code:10007 });
    return member(PLAYER);
  };
  s.channel.permissionsFor = item => ({ has:() => item.id === PLAYER || item.id === STAFF });
  await s.panel.refresh(s.context);
  assert.equal(s.message.body.content,'PIN 5820');
  joined = true;
  await s.emit('guildMemberAdd',member(PLAYER));
  assert.match(s.message.body.content,/unavailable/);
  assert.equal(s.panel.matches({ message:{ id:s.message.id },guildId:GUILD,channelId:CHANNEL }),false);
});

test('binding-save failure redacts the untracked message without an automatic message-creation loop', async t => {
  const s = await setup(t,5,{ failBindingSave:true });
  assert.equal(s.sends(),1);
  assert.match(s.message.body.content,/unavailable/);
  assert.equal(s.panel.matches({ message:{ id:s.message.id },guildId:GUILD,channelId:CHANNEL }),false);
  const fetches = s.fetches();
  await new Promise(resolve => setTimeout(resolve,60));
  assert.equal(s.sends(),1);
  assert.equal(s.fetches(),fetches);
  assert.equal(s.logs.filter(event => event.type === 'discord.panel.restore_failed').length,1);
});

test('new visible roles trigger verification and redaction; privileged roles also trigger verification', async t => {
  const s = await setup(t);
  const administrator = role(FOREIGN,[PermissionFlagsBits.Administrator]);
  s.channel.guild.roles.cache.set(administrator.id,administrator);
  await s.emit('roleCreate',administrator);
  assert.equal(s.reads(),2);
  assert.equal(s.edits(),0);
  const visible = role(ORDINARY,[PermissionFlagsBits.ViewChannel]);
  s.channel.guild.roles.cache.set(visible.id,visible);
  s.channel.permissionsFor = item => ({
    has:() => item.id === ORDINARY || item.id === STAFF
  });
  await s.emit('roleCreate',visible);
  assert.match(s.message.body.content,/unavailable/);
  assert.equal(s.reads(),2);
  assert.equal(s.panel.matches({ message:{ id:s.message.id },guildId:GUILD,channelId:CHANNEL }),false);
});

test('an uncached member becoming available with a readable overwrite triggers redaction', async t => {
  const s = await setup(t);
  s.channel.members.set(PLAYER,member(PLAYER));
  s.channel.permissionsFor = item => ({ has:() => item.id === PLAYER || item.id === STAFF });
  await s.emit('guildMemberAvailable',member(PLAYER));
  assert.match(s.message.body.content,/unavailable/);
  assert.equal(s.reads(),1);
  assert.equal(s.panel.matches({ message:{ id:s.message.id },guildId:GUILD,channelId:CHANNEL }),false);
});

test('privacy events queued at restore settlement still receive a complete recheck', async t => {
  for (const depth of [1,2,3,4,5,6]) {
    await t.test(`settlement microtask depth ${depth}`,async t => {
      const s = await setup(t);
      s.setText('PIN 6942');
      const edit = s.message.edit;
      let injected = false;
      let eventWork;
      let resolveEvent;
      const eventSent = new Promise(resolve => { resolveEvent = resolve; });
      s.message.edit = async body => {
        await edit(body);
        if (injected) return;
        injected = true;
        const queueEvent = remaining => {
          queueMicrotask(() => {
            if (remaining > 0) return queueEvent(remaining - 1);
            s.channel.permissionsFor = () => ({ has:() => true });
            eventWork = s.emit('channelUpdate',s.channel);
            resolveEvent();
          });
        };
        queueEvent(depth);
      };
      const refreshing = s.panel.refresh(s.context);
      await eventSent;
      await Promise.all([refreshing,eventWork]);
      assert.match(s.message.body.content,/unavailable/);
      assert(!JSON.stringify(s.message.body).includes('6942'));
      assert.equal(s.panel.matches({ message:{ id:s.message.id },guildId:GUILD,channelId:CHANNEL }),false);
    });
  }
});
