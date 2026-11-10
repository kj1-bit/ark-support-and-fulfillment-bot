'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { setTimeout:delay } = require('node:timers/promises');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteTicketRepository } = require('../../src/adapters/sqlite/ticket-repository');
const { createSqlitePanelRepository } = require('../../src/adapters/sqlite/panel-repository');
const { createSqliteSessionRepository } = require('../../src/adapters/sqlite/session-repository');
const { createSessionStore } = require('../../src/domain/sessions/session-store');
const { createTicketService } = require('../../src/domain/tickets/ticket-service');
const { createAuthorizationPolicy, authorize } = require('../../src/security/authorization');
const { createTicketsFeature } = require('../../src/features/tickets-feature');
const { openTicketsPayload } = require('../../src/adapters/discord/ticket-view');
const { assertUniqueCustomIds } = require('../helpers/custom-ids');

const id = n => `1000000000000${String(n).padStart(4,'0')}`;
const discord = { guildId:id(1),roles:{ staff:id(2) },
  channels:{ requests:id(3),ticketLogs:id(4),ticketCategory:id(5) } };
const staff = { actorId:id(7),guildId:id(1),channelId:id(4),roleIds:[id(2)] };
const migrationNames = ['v2-core','trusted-state','player-names','tickets','pins','operational-events',
  'fulfillment-targets','trusted-identity-associations','discord-panels','fulfillment-result-redaction',
  'schema-integrity','ticket-channels','vault-pins'];
const buttons = body => body.components.flatMap(row => row.components);

async function setup(t, { publicLogs = false } = {}) {
  const database = await openSqliteDatabase(':memory:');
  await createMigrationRunner({ database,migrations:migrationNames.map((name,index) =>
    require(`../../src/migrations/${String(index + 1).padStart(3,'0')}-${name}`)) }).run();
  const repository = createSqliteTicketRepository(database);
  const panels = createSqlitePanelRepository(database);
  const audit = [], logs = [], sent = [], channels = new Map(), memberViewers = new Set();
  let publicChannel = publicLogs, nextId = 100, requester = 20, now = 1000, failSync = false;
  const client = new EventEmitter();
  client.user = { id:id(90) };
  client.isReady = () => true;
  const roles = new Map([id(1),id(2)].map(roleId => [roleId,{ id:roleId,permissions:{ has:() => false } }]));
  const members = new Map();
  const guild = { id:id(1),roles:{ cache:roles,fetch:async () => roles },
    members:{ me:client.user,fetch:async ({ user }) => members.get(user) } };
  function channel(channelId, properties = {}) {
    const messages = new Map();
    const value = {
      id:channelId,guildId:id(1),guild,name:'ticket',type:ChannelType.GuildText,...properties,messages,
      permissionOverwrites:{ cache:new Map(),set:async rows => {
        if (failSync) throw new Error('test permission update failure');
        value.overwrites = rows;
      } },
      permissionsFor:item => ({ has:flag => item.id === id(90) || item.id === id(2)
        || (channelId === id(4) && flag === PermissionFlagsBits.ViewChannel
          && (publicChannel || memberViewers.has(item.id))) }),
      setName:async name => { value.name = name; return value; },
      send:async body => {
        const message = { id:id(nextId++),channelId,guildId:id(1),author:client.user,body,edits:0,
          edit:async payload => { message.body = { ...message.body,...payload }; message.edits += 1; return message; } };
        messages.set(message.id,message);
        sent.push(message);
        return message;
      }
    };
    value.messageStore = messages;
    value.messages = { fetch:async key => {
      if (typeof key === 'object') return messages;
      const message = messages.get(key);
      if (!message) throw Object.assign(new Error('Unknown Message'),{ code:10008 });
      return message;
    } };
    channels.set(channelId,value);
    return value;
  }
  channel(id(3));
  channel(id(4));
  channel(id(5),{ type:ChannelType.GuildCategory });
  guild.channels = {
    fetch:async channelId => channelId ? channels.get(channelId) : channels,
    create:async options => channel(id(nextId++),{ ...options,parentId:options.parent })
  };
  client.channels = { fetch:async channelId => channels.get(channelId) };
  client.guilds = { fetch:async () => guild };
  const policy = createAuthorizationPolicy({ guildId:id(1),capabilities:{
    'tickets.moderate':{ roleIds:[id(2)],channelIds:[id(3),id(4)] },
    'tickets.channel-moderate':{ roleIds:[id(2)],channelIds:[] }
  } });
  const authorization = { authorize:(capability,context) => authorize(policy,capability,context) };
  const tickets = createTicketService({
    repository,panels,authorization,channelConfig:discord,uuid:randomUUID,clock:() => now++,
    interactionGuard:createSessionStore({ repository:createSqliteSessionRepository(database),clock:() => now++ }),
    playerNames:{ get:async () => ({ status:'VERIFIED',playerName:'Mud' }) },
    audit:{ write:(type,data) => audit.push({ type,data }) }
  });
  const context = { client,config:{ discord,features:{ tickets:true,shop:false,dashboards:false } },
    services:{ tickets,authorization,dashboardPanels:panels },logSink:async event => logs.push(event) };
  let feature = createTicketsFeature();
  async function start() {
    await feature.initialize(context);
    await feature.register(context);
    await feature.start(context);
  }
  t.after(async () => { await feature.stop(context); await database.close(); });
  await start();
  const emit = (event,...args) => Promise.all(client.listeners(event).map(listener => listener(...args)));
  const current = async () => {
    const binding = await panels.get('open-tickets');
    return binding && channels.get(binding.channelId).messageStore.get(binding.messageId);
  };
  async function create() {
    return tickets.create({ type:'SUPPORT',description:'Never show this description',username:'Mud',
      context:{ actorId:id(requester++),guildId:id(1),channelId:id(3),roleIds:[] } });
  }
  const ticketContext = (record, actorId = id(7)) => ({
    ...staff,actorId,channelId:record.channelId,messageId:record.messageId
  });
  async function unclaimInput(record, overrides = {}) {
    return { ticketId:record.id,context:{ ...staff,messageId:(await panels.get('open-tickets')).messageId,...overrides } };
  }
  function interaction(customId, overrides = {}) {
    const item = {
      customId,user:{ id:staff.actorId },guildId:id(1),channelId:id(4),channel:channels.get(id(4)),
      member:{ roleIds:[id(2)] },replies:[],isButton:() => true,isModalSubmit:() => false,
      deferReply:async body => { item.deferred = true; item.deferPayload = body; },
      deferUpdate:async () => { item.deferred = true; item.updateDeferred = true; },
      reply:async body => { item.replies.push(body); item.replied = true; },
      editReply:async body => { item.replies.push(body); },
      followUp:async body => { item.replies.push(body); },...overrides
    };
    return item;
  }
  async function click(button, overrides = {}) {
    const item = interaction(button.custom_id,{ message:{ id:(await panels.get('open-tickets')).messageId },...overrides });
    await emit('interactionCreate',item);
    return item;
  }
  return {
    database,repository,panels,tickets,context,client,channels,audit,logs,sent,current,create,ticketContext,unclaimInput,
    emit,click,interaction,settle:() => delay(230),
    failSync:value => { failSync = value; },publicLogs:value => { publicChannel = value; },
    addNonstaffMember:() => {
      memberViewers.add(id(80));
      members.set(id(80),{ id:id(80),user:{ bot:false },roles:{ cache:new Map() },permissions:{ has:() => false } });
      channels.get(id(4)).permissionOverwrites.cache.set(id(80),{ id:id(80),type:1 });
    },
    stop:() => feature.stop(context),
    restart:async () => { await feature.stop(context); feature = createTicketsFeature(); await start(); }
  };
}

test('Open Tickets is a separate persistent staff panel even with dashboards disabled; empty and single views are minimal', async t => {
  const s = await setup(t);
  const empty = await s.current();
  assert.equal(empty.body.embeds[0].title,'Open Tickets');
  assert.equal(empty.body.embeds[0].description,'No open tickets.');
  assert.deepEqual(empty.body.components,[]);
  assert(await s.panels.get('legacy-tickets'));
  const record = await s.create();
  await s.settle();
  const message = await s.current();
  assert.equal(message.id,empty.id);
  assert.match(message.body.embeds[0].description,/^\*\*1\.\*\* <@\d+> \(Mud\)\nUnclaimed\n<#\d+>$/);
  assert(!JSON.stringify(message.body).includes('Never show'));
  assert(!JSON.stringify(message.body).includes(record.id));
  assert.deepEqual(buttons(message.body).map(button => button.label),['Unclaim 1']);
  assert.equal(buttons(message.body)[0].disabled,true);
  assert.deepEqual(message.body.allowedMentions,{ parse:[] });
  assert.equal(message.body.embeds[0].footer,undefined);
  assertUniqueCustomIds(message.body);
});

test('real SQLite pages all nonclosed states including completed and legacy tickets, excluding closed and other guilds', async t => {
  const s = await setup(t);
  const created = [];
  for (let i = 0; i < 6; i += 1) created.push(await s.create());
  await s.tickets.claim({ ticketId:created[1].id,context:s.ticketContext(created[1]) });
  await s.tickets.claim({ ticketId:created[2].id,context:s.ticketContext(created[2]) });
  await s.tickets.complete({ ticketId:created[2].id,context:s.ticketContext(created[2],id(8)) });
  await s.tickets.close({ ticketId:created[5].id,context:s.ticketContext(created[5]) });
  for (const guildId of [id(1),id(9)]) {
    await s.repository.create({ id:`legacy-${guildId}`,actorId:id(70),playerName:'Legacy Mud',guildId,
      channelId:id(3),type:'SUPPORT',description:'hidden',state:'OPEN',createdAt:10000,updatedAt:10000 });
  }
  const first = await s.tickets.openPage({ context:staff,page:1 });
  const second = await s.tickets.openPage({ context:staff,page:2 });
  assert.equal(first.total,6);
  assert.equal(first.results.length,5);
  assert.equal(second.results.length,1);
  assert.equal(second.results[0].channelStatus,null);
  assert(![...first.results,...second.results].some(record => record.id === created[5].id));
  assert.equal(first.results[2].moderatorId,id(7),'completion actor must not replace the claimant');
  await s.settle();
  const page = (await s.current()).body;
  assert(page.embeds[0].description.includes(`Claimed - <@${id(7)}>`));
  assert(page.embeds[0].description.includes(`Completed - Claimed - <@${id(7)}>`));
  assert.equal(page.embeds[0].footer.text,'Page 1 of 2');
  assertUniqueCustomIds(page);
  await s.click(buttons(page).find(button => button.label === 'Next'));
  const last = (await s.current()).body;
  assert.match(last.embeds[0].description,/^\*\*6\.\*\*/);
  assert.match(last.embeds[0].description,/Legacy ticket - no channel/);
  assert(!last.embeds[0].description.includes(`<#${id(3)}>`));
  assert.equal(buttons(last).find(button => button.label === 'Next').disabled,true);
  assertUniqueCustomIds(last);
  const clamped = await s.tickets.openPage({ context:staff,page:10000 });
  assert.equal(clamped.page,2);
  await assert.rejects(s.tickets.openPage({ context:staff,page:0 }),/Invalid/);
});

test('any authorized staff may unclaim; the private acknowledgment, audit actors and restored channel controls are correct', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  const button = buttons((await s.current()).body)[0];
  assert.equal(button.disabled,false);
  const result = await s.click(button,{ user:{ id:id(8) } });
  assert.deepEqual(result.deferPayload,{ flags:64 });
  assert.equal(result.replies[0].content,'Ticket unclaimed.');
  assert.equal(result.replies[0].flags,64);
  const stored = await s.repository.get(record.id);
  assert.equal(stored.state,'OPEN');
  assert.equal(stored.moderatorId,null);
  const event = s.audit.find(event => event.type === 'ticket.unclaimed');
  assert.equal(event.data.actionActorId,id(8));
  assert.equal(event.data.previousClaimantId,id(7));
  const control = await s.channels.get(record.channelId).messages.fetch(record.messageId);
  assert(buttons(control.body).some(button => button.label === 'Claim Ticket'));
  assert(!control.body.content.includes(id(7)));
  assert(!control.body.content.includes(id(8)));
  const repeated = await s.click(button);
  assert.equal(repeated.replies[0].content,'This ticket is already unclaimed.');
  assert.equal(s.audit.filter(event => event.type === 'ticket.unclaimed').length,1);
  await s.settle();
  assert.match((await s.current()).body.embeds[0].description,/\nUnclaimed\n/);
});

test('page changes invalidate old entry tokens and closing the last page clamps the panel back to existing entries', async t => {
  const s = await setup(t);
  const records = [];
  for (let i = 0; i < 6; i += 1) records.push(await s.create());
  await s.tickets.claim({ ticketId:records[0].id,context:s.ticketContext(records[0]) });
  await s.settle();
  const first = (await s.current()).body;
  const old = buttons(first)[0];
  await s.click(buttons(first).find(button => button.label === 'Next'));
  const stale = await s.click(old);
  assert.equal(stale.replies[0].content,'This Open Tickets entry is no longer available.');
  assert.equal((await s.repository.get(records[0].id)).state,'CLAIMED');
  await s.tickets.close({ ticketId:records[5].id,context:s.ticketContext(records[5]) });
  await s.settle();
  const body = (await s.current()).body;
  assert.match(body.embeds[0].description,/^\*\*1\.\*\*/);
  assert.equal(body.embeds[0].footer,undefined);
  assert(!buttons(body).some(button => ['Previous','Next'].includes(button.label)));
});

test('service-bound unclaim rejects nonstaff, wrong guild/channel, missing, stale and replaced panel bindings', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  for (const overrides of [{ roleIds:[] },{ guildId:id(9) },{ channelId:id(3) },
    { messageId:undefined },{ messageId:id(99) }]) {
    await assert.rejects(s.tickets.unclaim(await s.unclaimInput(record,overrides)));
  }
  await s.panels.save({ panelKey:'open-tickets',channelId:id(3),messageId:id(99),updatedAt:1 });
  await assert.rejects(s.tickets.unclaim({ ticketId:record.id,context:{ ...staff,messageId:id(99) } }),/no longer valid/);
  assert.equal((await s.repository.get(record.id)).state,'CLAIMED');
  assert(!s.audit.some(event => event.type === 'ticket.unclaimed'));
  await s.database.run("DELETE FROM discord_panel_messages WHERE panel_key='open-tickets'");
  await assert.rejects(s.tickets.unclaim({ ticketId:record.id,context:{ ...staff,messageId:id(99) } }),/no longer valid/);
});

test('panel unclaim rejects nonstaff and copied or mismatched message contexts without changing stored assignments', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  const button = buttons((await s.current()).body)[0];
  for (const overrides of [{ member:{ roleIds:[] } },{ guildId:id(9) },{ channelId:id(3) },
    { message:undefined },{ message:{ id:id(99) } }]) {
    const denied = await s.click(button,overrides);
    assert.equal(denied.replies.length,1);
    assert.equal(denied.replies[0].flags,64);
    assert.equal((await s.repository.get(record.id)).state,'CLAIMED');
  }
  assert(!s.audit.some(event => event.type === 'ticket.unclaimed'));
});

test('unclaimed and closed tickets produce private no-ops without timestamp or audit mutations, even for stale displayed buttons', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.settle();
  const button = buttons((await s.current()).body)[0];
  const before = await s.repository.get(record.id);
  const unclaimed = await s.click(button);
  assert.equal(unclaimed.replies[0].content,'This ticket is already unclaimed.');
  assert.equal((await s.repository.get(record.id)).updated_at,before.updated_at);
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  await s.tickets.close({ ticketId:record.id,context:s.ticketContext(record) });
  const closed = await s.click(button);
  assert.equal(closed.replies[0].content,'This ticket is already closed.');
  assert.equal(closed.deferPayload.flags,64);
  assert.equal((await s.repository.get(record.id)).state,'CLOSED');
  assert(!s.audit.some(event => event.type === 'ticket.unclaimed'));
  await s.settle();
  const removed = await s.click(button);
  assert.equal(removed.replies[0].content,'This Open Tickets entry is no longer available.');
});

test('completed unclaim preserves completion, restores Claim Ticket, and allows reassigning without double-completion', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  const completed = await s.tickets.complete({ ticketId:record.id,context:s.ticketContext(record,id(8)) });
  await s.tickets.unclaim(await s.unclaimInput(record));
  const unclaimed = await s.repository.get(record.id);
  assert.equal(unclaimed.state,'COMPLETED');
  assert.equal(unclaimed.completedAt,completed.completedAt);
  assert.equal(unclaimed.moderatorId,null);
  const control = await s.channels.get(record.channelId).messages.fetch(record.messageId);
  assert(buttons(control.body).find(button => button.label === 'Claim Ticket'));
  assert.equal(buttons(control.body).find(button => button.label === 'Ticket Completed').disabled,true);
  await s.settle();
  assert.match((await s.current()).body.embeds[0].description,/Completed - Unclaimed/);
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record,id(8)) });
  const reassigned = await s.repository.get(record.id);
  assert.equal(reassigned.state,'COMPLETED');
  assert.equal(reassigned.moderatorId,id(8));
  await assert.rejects(s.tickets.complete({ ticketId:record.id,context:s.ticketContext(record) }),/already completed/);
});

test('claim/unclaim races serialize consistently and the atomic repository guard never clears a newer claimant or closed ticket', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  const input = await s.unclaimInput(record);
  const release = s.tickets.unclaim(input);
  const claim = s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record,id(8)) });
  await Promise.all([release,claim]);
  assert.equal((await s.repository.get(record.id)).moderatorId,id(8));
  assert.equal(await s.repository.unclaim(record.id,id(7),5000),false);
  assert.equal((await s.repository.get(record.id)).state,'CLAIMED');
  const control = await s.channels.get(record.channelId).messages.fetch(record.messageId);
  assert(!buttons(control.body).some(button => button.label === 'Claim Ticket'));
  await s.tickets.close({ ticketId:record.id,context:s.ticketContext(record) });
  assert.equal(await s.repository.unclaim(record.id,id(8),5000),false);
  assert.equal((await s.repository.get(record.id)).state,'CLOSED');
  await s.tickets.reopen({ ticketId:record.id,context:s.ticketContext(record) });
  const claimFirst = s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  const releaseSecond = s.tickets.unclaim(input);
  await Promise.all([claimFirst,releaseSecond]);
  assert.equal((await s.repository.get(record.id)).state,'OPEN');
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  const repeats = await Promise.all([s.tickets.unclaim(input),s.tickets.unclaim(input)]);
  assert.deepEqual(repeats.map(result => result.changed),[true,false]);
});

test('legacy assignments unclaim without creating a channel and legacy actions refresh the same panel', async t => {
  const s = await setup(t);
  const legacy = await s.repository.create({
    id:'legacy-open',actorId:id(70),playerName:'Old Mud',guildId:id(1),channelId:id(3),
    state:'OPEN',type:'SUPPORT',description:'Original request',createdAt:100,updatedAt:100
  });
  const privateContext = { ...staff,messageId:id(2000) };
  async function legacyAction(action) {
    const view = await s.tickets.legacyControls({ ticketId:legacy.id,context:privateContext });
    const control = view.controls.find(control => control.action === action);
    return s.tickets.legacyAction({ action,token:control.token,context:privateContext });
  }
  const count = s.channels.size;
  await legacyAction('claim');
  await s.settle();
  assert.match((await s.current()).body.embeds[0].description,/Claimed - <@\d+>\nLegacy ticket - no channel/);
  await s.tickets.unclaim(await s.unclaimInput(legacy));
  await s.settle();
  assert.match((await s.current()).body.embeds[0].description,/Unclaimed\nLegacy ticket - no channel/);
  await legacyAction('complete');
  await s.settle();
  assert.match((await s.current()).body.embeds[0].description,/Completed - Unclaimed/);
  await legacyAction('close');
  await s.settle();
  assert.equal((await s.current()).body.embeds[0].description,'No open tickets.');
  assert.equal(s.channels.size,count);
});

test('a failed unclaim sync is audited and retryable without repeating its state transition', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  s.failSync(true);
  await assert.rejects(s.tickets.unclaim(await s.unclaimInput(record)),/test permission update failure/);
  assert.equal((await s.repository.get(record.id)).state,'OPEN');
  assert(s.audit.some(event => event.type === 'ticket.channel_failed' && event.data.phase === 'unclaim'));
  s.failSync(false);
  await s.tickets.unclaim(await s.unclaimInput(record));
  assert.equal(s.audit.filter(event => event.type === 'ticket.unclaimed').length,1);
  const control = await s.channels.get(record.channelId).messages.fetch(record.messageId);
  assert(buttons(control.body).some(button => button.label === 'Claim Ticket'));
});

test('panel refreshes after each lifecycle action and coalesces bursts instead of spamming edits', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.settle();
  const message = await s.current();
  assert.match(message.body.embeds[0].description,/Unclaimed/);
  const claim = () => s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  await claim();
  await s.settle();
  assert.match(message.body.embeds[0].description,/Claimed/);
  await s.tickets.unclaim(await s.unclaimInput(record));
  await s.settle();
  assert.match(message.body.embeds[0].description,/Unclaimed/);
  await s.tickets.complete({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  assert.match(message.body.embeds[0].description,/Completed - Unclaimed/);
  await s.tickets.close({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  assert.equal(message.body.embeds[0].description,'No open tickets.');
  await s.tickets.reopen({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  assert.match(message.body.embeds[0].description,/Unclaimed/);
  assert(!message.body.embeds[0].description.includes('Completed'));
  const before = message.edits;
  await claim();
  await s.tickets.complete({ ticketId:record.id,context:s.ticketContext(record) });
  await s.tickets.close({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  assert.equal(message.edits,before + 1);
});

test('deletion and restart restore only the bound Open Tickets message, invalidating stale buttons', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  const old = await s.current();
  const button = buttons(old.body)[0];
  s.channels.get(id(4)).messageStore.delete(old.id);
  await s.emit('messageDelete',old);
  const replacement = await s.current();
  assert.notEqual(replacement.id,old.id);
  assert.match(replacement.body.embeds[0].description,/Claimed/);
  const stale = await s.click(button,{ message:{ id:old.id } });
  assert.equal(stale.replies[0].flags,64);
  assert.equal((await s.repository.get(record.id)).state,'CLAIMED');
  const count = s.sent.length;
  await s.restart();
  assert.equal((await s.current()).id,replacement.id);
  assert.equal(s.sent.length,count);
  assert.match((await s.current()).body.embeds[0].description,/Claimed/);
  await s.click(button);
  assert.equal((await s.repository.get(record.id)).state,'CLAIMED','old tokens must not survive restart');
});

test('public log channels fail closed; later role/member privacy failures redact the panel and block unclaim', async t => {
  const publicState = await setup(t,{ publicLogs:true });
  assert.equal(await publicState.current(),undefined);
  assert(publicState.logs.some(event => event.type === 'discord.panel.restore_failed' && event.data.panel === 'open-tickets'));
  const s = await setup(t);
  const record = await s.create();
  await s.tickets.claim({ ticketId:record.id,context:s.ticketContext(record) });
  await s.settle();
  const message = await s.current();
  const button = buttons(message.body)[0];
  s.addNonstaffMember();
  const denied = await s.click(button);
  assert.equal(denied.replies[0].flags,64);
  assert.equal((await s.repository.get(record.id)).state,'CLAIMED');
  assert.deepEqual(message.body.embeds,[]);
  assert.deepEqual(message.body.components,[]);
  assert.equal(message.body.content,'Open Tickets unavailable. Staff must verify channel privacy.');
});

test('observed privacy changes redact Open Tickets, restore it when safe, and prevent public paging errors', async t => {
  const s = await setup(t);
  for (let i = 0; i < 6; i += 1) await s.create();
  await s.settle();
  const message = await s.current();
  const next = buttons(message.body).find(button => button.label === 'Next');
  s.publicLogs(true);
  const denied = await s.click(next);
  assert.equal(denied.updateDeferred,true);
  assert.equal(denied.replies[0].flags,64);
  assert.equal(message.body.content,'Open Tickets unavailable. Staff must verify channel privacy.');
  assert.deepEqual(message.body.embeds,[]);
  s.publicLogs(false);
  await s.emit('channelUpdate',s.channels.get(id(4)));
  assert.equal(message.body.embeds[0].title,'Open Tickets');
  assert.equal(message.body.content,null);
  s.publicLogs(true);
  await s.emit('channelUpdate',s.channels.get(id(4)));
  assert.deepEqual(message.body.embeds,[]);
});

test('stopping cancels queued refreshes and removes the ticket subscription and panel listeners', async t => {
  const s = await setup(t);
  const message = await s.current();
  await s.create();
  await s.stop();
  const edits = message.edits;
  await s.settle();
  assert.equal(message.edits,edits);
  await s.create();
  await s.settle();
  assert.equal(message.edits,edits);
  assert.equal(s.client.eventNames().length,0);
});

test('panel rendering escapes hostile names and stays within Discord embed/component limits on every page', () => {
  const results = Array.from({ length:5 },(_,index) => ({
    actorId:id(20 + index),playerName:'**spoof** @everyone <@123> `code`\nnext',
    state:index === 2 ? 'COMPLETED' : index ? 'CLAIMED' : 'OPEN',
    moderatorId:index ? id(7) : null,channelStatus:index ? 'ACTIVE' : null,
    channelId:id(40 + index),unclaimToken:randomUUID()
  }));
  for (const page of [1,2,3]) {
    const body = openTicketsPayload({ page,pageSize:5,total:15,results });
    assertUniqueCustomIds(body);
    assert(body.embeds[0].description.length <= 4096);
    assert(body.components.length <= 5);
    assert(body.components.every(row => row.components.length <= 5));
    assert(body.embeds[0].description.includes('\\*\\*spoof\\*\\*'));
    assert(!body.embeds[0].description.includes('@everyone'));
    assert(!body.embeds[0].description.includes('<@123>'));
    assert.deepEqual(body.allowedMentions,{ parse:[] });
  }
});
