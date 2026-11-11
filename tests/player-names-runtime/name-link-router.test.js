'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNameLinkRouter } = require('../../src/adapters/discord/name-link-router');
const { privatePinChannel } = require('../helpers/private-pin-channel');

const id = n => `1000000000000${String(n).padStart(4,'0')}`;
const guildId = id(1), channelId = id(2), staff = id(3), actor = id(4), panelId = id(5), messageId = id(6);
const target = id(7), eos = 'a'.repeat(32);
const component = (view,label) => view.components.flatMap(row => row.components).find(c => c.label === label || c.placeholder === label);
function interaction(kind, customId, values = [], extra = {}) {
  const i = { customId,values,user:{ id:actor },guildId,channelId,message:{ id:messageId },
    member:{ roleIds:[staff] },isButton:() => kind === 'button',isStringSelectMenu:() => kind === 'select',
    isUserSelectMenu:() => kind === 'member',isModalSubmit:() => kind === 'modal',
    deferReply:async () => {},deferUpdate:async () => {},
    editReply:async body => { i.output = body; return { id:messageId }; },
    showModal:async modal => { i.output = modal.toJSON(); },...extra };
  return i;
}
function setup({ trusted = false, empty = false } = {}) {
  const client = new EventEmitter();
  const config = { discord:{ guildId,roles:{ staff },channels:{ pinsDashboard:channelId } },
    ark:{ servers:[{ id:'map',name:'Map' }] } };
  client.channels = { fetch:async () => privatePinChannel({ channelId,guildId,staffRoleId:staff }) };
  let linked = null;
  const request = { discordId:target,playerName:'Joe',status:'PENDING',updatedAt:10 };
  const events = [];
  client.on('v2PlayerNamesChanged',() => events.push('names'));
  client.on('v2VaultPinsChanged',() => events.push('pins'));
  const services = {
    authorization:{ authorize(_capability,context) {
      if (context.guildId !== guildId || context.channelId !== channelId || !context.roleIds.includes(staff)) throw new Error('not authorized');
    } },
    playerNames:{ queue:async () => ({ results:linked ? [] : [request],page:1,pageSize:10,total:linked ? 0 : 1 }),
      linkedName:async () => linked && { displayName:'Renamed' } },
    onlinePlayers:{
      matching:async () => ({ players:empty ? [] : [{ playerRef:'ref',displayName:'Joe',serverId:'map',lastSeenAt:100,
        maskedEos:'aaaa…aaaa',trusted }],page:1,pageSize:25,total:empty ? 0 : 1 }),
      scanPage:async () => ({ players:[],page:1,pageSize:25,total:0 }),
      resolve:() => ({ eosId:eos,displayName:'Joe',serverId:'map',lastSeenAt:100 })
    },
    playerLinks:{
      assertUnlinked(_discordId, selectedEos) {
        if (linked || (trusted && selectedEos)) throw Object.assign(new Error('already linked'),{ code:'IDENTITY_ALREADY_LINKED' });
      },
      get:() => linked,
      link:async input => { linked = { ...input,discordId:target }; return linked; },
      unlink:async () => { linked = null; }
    }
  };
  const router = createNameLinkRouter({ client,config,services },{ matches:i => i.message.id === panelId,refresh:async () => {} });
  async function send(i) { await router.handle(i); return i.output; }
  return { send,request,events,get linked() { return linked; } };
}
test('staff request selection requires bound actor, role, guild, channel, message and explicit confirmation', async () => {
  const s = setup();
  const picker = await s.send(interaction('button','v2:name-requests:link',[],{ message:{ id:panelId } }));
  assert.match(picker.content,/<@/);
  assert.deepEqual(picker.allowedMentions,{ parse:[] });
  const menu = component(picker,'Select a request');
  for (const extra of [{ user:{ id:id(8) } },{ guildId:id(8) },{ channelId:id(8) },
    { message:{ id:id(8) } },{ member:{ roleIds:[] } }]) {
    await assert.rejects(() => s.send(interaction('select',menu.custom_id,[target],extra)));
  }
  const candidates = await s.send(interaction('select',menu.custom_id,[target]));
  assert.match(candidates.content,/Matching remembered players/);
  const selected = component(candidates,'Select a remembered player');
  const review = await s.send(interaction('select',selected.custom_id,['ref']));
  assert.match(review.content,/aaaa…aaaa/);
  assert(!review.content.includes(eos));
  assert.equal(s.linked,null);
  const confirm = component(review,'Confirm Link').custom_id;
  const done = await s.send(interaction('button',confirm));
  assert.match(done.content,/Linked/);
  assert.equal(s.linked.eosId,eos);
  assert.deepEqual(s.events,['names','pins']);
  await assert.rejects(() => s.send(interaction('button',confirm)),/invalid or expired/);
});

test('no matches keep fallbacks and already-linked candidates are blocked without revealing an owner', async () => {
  for (const options of [{ empty:true },{ trusted:true }]) {
    const s = setup(options);
    const picker = await s.send(interaction('button','v2:name-requests:link',[],{ message:{ id:panelId } }));
    const view = await s.send(interaction('select',component(picker,'Select a request').custom_id,[target]));
    assert(component(view,'Refresh'));
    assert(component(view,'Browse All Remembered Players'));
    assert(component(view,'Enter EOS Manually'));
    assert(component(view,'Cancel'));
    if (options.empty) assert.match(view.content,/No matching remembered players found/);
    else {
      const menu = component(view,'Select a remembered player');
      assert.match(menu.options[0].description,/Already linked/);
      assert(!JSON.stringify(menu.options).includes(target));
      await assert.rejects(() => s.send(interaction('select',menu.custom_id,['ref'])),{ code:'IDENTITY_ALREADY_LINKED' });
    }
  }
});
test('manual entry requires review, unlink displays newest name, and expired flows fail', async t => {
  const s = setup();
  const picker = await s.send(interaction('button','v2:name-requests:link',[],{ message:{ id:panelId } }));
  const candidates = await s.send(interaction('select',component(picker,'Select a request').custom_id,[target]));
  const modal = await s.send(interaction('button',component(candidates,'Enter EOS Manually').custom_id));
  assert.equal(modal.components[0].components[0].value,'Joe');
  for (const extra of [{ user:{ id:id(8) } },{ message:{ id:id(8) } },{ member:{ roleIds:[] } }]) {
    await assert.rejects(() => s.send(interaction('modal',modal.custom_id,[],{
      fields:{ getTextInputValue:key => key === 'player-name' ? 'Joe' : eos },...extra })));
  }
  const review = await s.send(interaction('modal',modal.custom_id,[],{
    fields:{ getTextInputValue:key => key === 'player-name' ? 'Joe' : eos }
  }));
  for (const extra of [{ user:{ id:id(8) } },{ message:{ id:id(8) } },{ member:{ roleIds:[] } }]) {
    await assert.rejects(() => s.send(interaction('button',component(review,'Confirm Link').custom_id,[],extra)));
    assert.equal(s.linked,null);
  }
  await s.send(interaction('button',component(review,'Confirm Link').custom_id));
  const unlink = await s.send(interaction('button','v2:name-requests:unlink',[],{ message:{ id:panelId } }));
  const unlinkReview = await s.send(interaction('member',component(unlink,'Select a Discord member').custom_id,[target]));
  assert.match(unlinkReview.content,/Renamed/);
  assert(!unlinkReview.content.includes(eos));
  await s.send(interaction('button',component(unlinkReview,'Confirm Unlink').custom_id));
  assert.equal(s.linked,null);
  assert.deepEqual(s.events,['names','pins','names','pins']);
  const next = await s.send(interaction('button','v2:name-requests:link',[],{ message:{ id:panelId } }));
  t.mock.method(Date,'now',() => Number.MAX_SAFE_INTEGER);
  await assert.rejects(() => s.send(interaction('select',component(next,'Select a request').custom_id,[target])),/expired/);
});
