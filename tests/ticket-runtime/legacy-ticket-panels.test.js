'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteTicketRepository } = require('../../src/adapters/sqlite/ticket-repository');
const { createSqlitePanelRepository } = require('../../src/adapters/sqlite/panel-repository');
const { createSqliteSessionRepository } = require('../../src/adapters/sqlite/session-repository');
const { createSqliteRetentionRepository } = require('../../src/adapters/sqlite/retention-repository');
const { createSessionStore } = require('../../src/domain/sessions/session-store');
const { createTicketService } = require('../../src/domain/tickets/ticket-service');
const { createAuthorizationPolicy, authorize } = require('../../src/security/authorization');
const { createTicketsFeature } = require('../../src/features/tickets-feature');
const { assertUniqueCustomIds } = require('../helpers/custom-ids');

const names = ['v2-core','trusted-state','player-names','tickets','pins','operational-events',
  'fulfillment-targets','trusted-identity-associations','discord-panels','fulfillment-result-redaction',
  'schema-integrity','ticket-channels','vault-pins'];
const migrations = names.map((name, index) => require(`../../src/migrations/${String(index + 1).padStart(3, '0')}-${name}`));
const id = n => `100000000000000${String(n).padStart(2, '0')}`;
const discord = { guildId:id(1), roles:{ staff:id(2) },
  channels:{ requests:id(3), ticketLogs:id(4), ticketCategory:id(5) } };
const staff = { actorId:id(7), guildId:id(1), channelId:id(4), roleIds:[id(2)], messageId:id(9) };

async function setup(t, { publicLogs = false } = {}) {
  const db = await openSqliteDatabase(':memory:');
  await createMigrationRunner({ database:db, migrations:migrations.slice(0, 11) }).run();
  for (const [index, [ticketId, state, guildId, updatedAt]] of [
    ['TKT-schema11-open','OPEN',id(1),100],
    ['TKT-schema11-claimed','CLAIMED',id(1),100],
    ['TKT-schema11-closed','CLOSED',id(1),5000],
    ['TKT-foreign','OPEN',id(20),100]
  ].entries()) {
    await db.run(
      `INSERT INTO tickets (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ticketId,'SUPPORT','Original preserved request',id(60 + index),'Survivor',guildId,id(3),state,50,updatedAt]
    );
  }
  const original = await db.all('SELECT * FROM tickets ORDER BY id');
  assert.equal(await createMigrationRunner({ database:db, migrations }).run(),13);
  const upgraded = await db.all('SELECT * FROM tickets ORDER BY id');
  for (let index = 0; index < original.length; index += 1) {
    for (const [key, value] of Object.entries(original[index])) assert.equal(upgraded[index][key],value);
    assert.equal(upgraded[index].channel_status,null);
    assert.equal(upgraded[index].completed_at,null);
    assert.equal(upgraded[index].message_id,null);
  }

  let now = 1000;
  const events = [];
  const logEvents = [];
  const createdChannels = [];
  const posted = [];
  const policy = createAuthorizationPolicy({ guildId:id(1), capabilities:{
    'tickets.moderate':{ roleIds:[id(2)], channelIds:[id(3),id(4)] },
    'tickets.channel-moderate':{ roleIds:[id(2)], channelIds:[] }
  } });
  const authorization = { authorize:(capability, context) => authorize(policy,capability,context) };
  const repository = createSqliteTicketRepository(db);
  const interactionGuard = createSessionStore({ repository:createSqliteSessionRepository(db), clock:() => now });
  const tickets = createTicketService({
    repository, interactionGuard, authorization, channelConfig:discord, uuid:randomUUID, clock:() => now,
    playerNames:{ get:async () => ({ status:'VERIFIED',playerName:'Survivor' }) },
    audit:{ write:(type, data) => events.push({ type,data }) }
  });
  const panels = createSqlitePanelRepository(db);
  const guild = {
    id:id(1), members:{ me:{ id:id(30) } },
    roles:{ cache:new Map([id(1),id(2),id(31)].map(roleId => [roleId, {
      id:roleId, permissions:{ has:() => false }
    }])) }
  };
  const channels = new Map([id(3),id(4)].map(channelId => [channelId, {
    id:channelId, guildId:id(1), guild,
    permissionsFor:role => ({ has:flag => flag === PermissionFlagsBits.ViewChannel
      && (role.id === id(2) || (publicLogs && role.id === id(31))) }),
    send:async body => {
      const message = { id:id(40 + posted.length), channelId, guildId:id(1),
        edit:async payload => { message.body = payload; } };
      posted.push({ ...message, body });
      return message;
    },
    messages:{ fetch:async () => { throw Object.assign(new Error('Unknown Message'),{ code:10008 }); } }
  }]));
  const category = { id:id(5), guildId:id(1), guild, type:ChannelType.GuildCategory,
    permissionsFor:() => ({ has:() => true }) };
  guild.channels = {
    fetch:async channelId => channelId === id(5) ? category : channels.get(channelId),
    create:async input => { createdChannels.push(input); throw new Error('No channel should be created.'); }
  };
  const client = new EventEmitter();
  client.user = { id:id(30) };
  client.channels = { fetch:async channelId => channels.get(channelId) };
  client.guilds = { fetch:async () => guild };
  client.isReady = () => true;
  const context = { client, config:{ features:{ tickets:true,shop:false,dashboards:false }, discord },
    services:{ tickets, authorization, dashboardPanels:panels }, logSink:async event => logEvents.push(event) };
  const feature = createTicketsFeature();
  t.after(async () => { await feature.stop(context); await db.close(); });
  await feature.initialize(context);
  await feature.register(context);
  await feature.start(context);

  function interaction(customId, overrides = {}) {
    const replies = [];
    const item = {
      customId, user:{ id:id(7) }, guildId:id(1), channelId:id(4), channel:channels.get(id(4)),
      member:{ roleIds:[id(2)] }, message:{ id:id(9) }, replies,
      isButton:() => true, isModalSubmit:() => false,
      deferred:false, replied:false,
      deferReply:async payload => { item.deferred = true; item.deferOptions = payload; },
      deferUpdate:async () => { item.deferred = true; },
      reply:async payload => { item.replied = true; replies.push(payload); },
      editReply:async payload => { replies.push(payload); return { id:id(9) }; },
      showModal:async modal => { item.modal = modal.toJSON(); },
      ...overrides
    };
    return item;
  }
  async function dispatch(item) {
    for (const listener of client.listeners('interactionCreate')) await listener(item);
    return item;
  }
  async function open(ticketId = 'TKT-schema11-open') {
    const saved = await panels.get('legacy-tickets');
    const button = await dispatch(interaction('v2:legacy-ticket:open',{ message:{ id:saved.messageId } }));
    assert.equal(button.modal.title,'Manage Legacy Ticket');
    const modal = await dispatch(interaction(button.modal.custom_id,{
      isButton:() => false, isModalSubmit:() => true,
      message:{ id:saved.messageId }, fields:{ getTextInputValue:() => ticketId }
    }));
    assert.deepEqual(modal.deferOptions,{ flags:64 });
    assertUniqueCustomIds(modal.replies.at(-1),'legacy ticket view');
    return modal.replies.at(-1);
  }
  const control = (view, action) => view.components[0].components.find(item =>
    item.custom_id.startsWith(`v2:legacy-ticket:${action}:`)).custom_id;
  return { db, original, tickets, repository, panels, events, logEvents, createdChannels, client,
    channels, context, feature, interactionGuard, interaction, dispatch, open, control, advance:value => { now += value; } };
}

test('schema-11 legacy tickets stay intact after upgrade and a staff panel close enables retention without a channel', async t => {
  const s = await setup(t);
  assert.equal((await s.repository.get('TKT-schema11-open')).state,'OPEN');
  assert.equal((await s.repository.get('TKT-schema11-claimed')).state,'CLAIMED');
  assert.equal((await s.repository.get('TKT-schema11-closed')).state,'CLOSED');
  const view = await s.open();
  assert.match(view.content,/Original preserved request/);
  assert.equal((await s.repository.get('TKT-schema11-open')).state,'OPEN');
  const close = s.control(view,'close');
  const result = await s.dispatch(s.interaction(close));
  assert.match(result.replies.at(-1).content,/CLOSED/);
  const row = await s.repository.get('TKT-schema11-open');
  assert.equal(row.state,'CLOSED');
  assert.equal(row.channelStatus,null);
  assert.equal(row.channelId,id(3));
  assert.equal(row.updated_at,1000);
  assert(s.events.some(event => event.type === 'ticket.closed' && event.data.id === row.id));
  assert.deepEqual(s.createdChannels,[]);
  const retention = createSqliteRetentionRepository(s.db,{ beforePurgeClosedTickets:cutoff => s.tickets.purgeChannels(cutoff) });
  assert.equal(await retention.purgeClosedTickets(1001),1);
  assert.equal(await s.repository.get(row.id),null);
  assert.equal((await s.repository.get('TKT-schema11-claimed')).state,'CLAIMED');
  assert.equal((await s.repository.get('TKT-schema11-closed')).state,'CLOSED');
});

test('legacy panel controls preserve distinct claim, completion, closure and reopening meanings', async t => {
  const s = await setup(t);
  let view = await s.open();
  for (const [action, state, actions] of [
    ['claim','CLAIMED',['complete','close']],
    ['complete','COMPLETED',['close']],
    ['close','CLOSED',['reopen']],
    ['reopen','OPEN',['claim','complete','close']]
  ]) {
    const item = await s.dispatch(s.interaction(s.control(view,action)));
    view = item.replies.at(-1);
    assert.equal((await s.repository.get('TKT-schema11-open')).state,state);
    assert.deepEqual(view.components[0].components.map(button => button.custom_id.split(':')[2]),actions);
    assertUniqueCustomIds(view,`legacy ${state} controls`);
  }
  const row = await s.repository.get('TKT-schema11-open');
  assert.equal(row.completedAt,null);
  assert.equal(row.channelStatus,null);
  assert.deepEqual(s.createdChannels,[]);
  assert.deepEqual(s.events.map(event => event.type),['ticket.claimed','ticket.completed','ticket.closed','ticket.reopened']);
});

test('legacy records and actions reject non-staff, requester bypasses and foreign guild/channel/message/actor bindings', async t => {
  const s = await setup(t);
  const view = await s.open();
  const close = s.control(view,'close');
  const token = close.split(':')[3];
  await assert.rejects(() => s.tickets.getLegacy({ ticketId:'TKT-schema11-open',
    context:{ ...staff,roleIds:[] } }),/authorized/);
  await assert.rejects(() => s.tickets.getLegacy({ ticketId:'TKT-foreign',context:staff }),/guild/);
  await assert.rejects(() => s.tickets.close({ ticketId:'TKT-schema11-open',context:staff }),/legacy ticket management/);
  for (const overrides of [
    { member:{ roleIds:[] },user:{ id:id(60) } },
    { guildId:id(20) }, { channelId:id(3),channel:s.channels.get(id(3)) },
    { message:{ id:id(10) } }, { user:{ id:id(8) } }
  ]) {
    const item = await s.dispatch(s.interaction(close,overrides));
    assert.equal(item.replies.length,1);
    assert(!item.replies[0].content.includes('Original preserved request'));
    assert.equal((await s.repository.get('TKT-schema11-open')).state,'OPEN');
    assert.equal((await s.db.get('SELECT state FROM interaction_sessions WHERE token=?',[token])).state,'ACTIVE');
  }
  await s.dispatch(s.interaction(close));
  assert.equal((await s.repository.get('TKT-schema11-open')).state,'CLOSED');
  const replay = await s.dispatch(s.interaction(close));
  assert.match(replay.replies[0].content,/no longer valid/);
  assert.equal(s.events.filter(event => event.type === 'ticket.closed').length,1);
});

test('legacy lookup modals are actor-bound, single-use and invalidated when the standing panel is replaced', async t => {
  const s = await setup(t);
  const panel = await s.panels.get('legacy-tickets');
  const unauthorized = await s.dispatch(s.interaction('v2:legacy-ticket:open',{
    message:{ id:panel.messageId },member:{ roleIds:[] }
  }));
  assert.equal(unauthorized.modal,undefined);
  assert(!unauthorized.replies[0].content.includes('Original preserved request'));
  const item = await s.dispatch(s.interaction('v2:legacy-ticket:open',{ message:{ id:panel.messageId } }));
  const modal = overrides => s.interaction(item.modal.custom_id,{
    isButton:() => false,isModalSubmit:() => true,fields:{ getTextInputValue:() => 'TKT-schema11-open' },...overrides
  });
  const impostor = await s.dispatch(modal({ user:{ id:id(8) } }));
  assert(!impostor.replies[0].content.includes('Original preserved request'));
  const accepted = await s.dispatch(modal());
  assert.match(accepted.replies.at(-1).content,/Original preserved request/);
  const replay = await s.dispatch(modal());
  assert.match(replay.replies[0].content,/no longer valid/);

  const pending = await s.dispatch(s.interaction('v2:legacy-ticket:open',{ message:{ id:panel.messageId } }));
  for (const listener of s.client.listeners('messageDelete')) {
    await listener({ id:panel.messageId,channelId:id(4),guildId:id(1) });
  }
  const stale = await s.dispatch(modal({ customId:pending.modal.custom_id }));
  assert(!stale.replies[0].content.includes('Original preserved request'));
  const oldButton = await s.dispatch(s.interaction('v2:legacy-ticket:open',{ message:{ id:panel.messageId } }));
  assert.equal(oldButton.modal,undefined);
  assert.equal((await s.repository.get('TKT-schema11-open')).state,'OPEN');
});

test('legacy actions reject expired and other-feature sessions and never manage private-channel tickets', async t => {
  const s = await setup(t);
  const view = await s.open();
  const other = await s.interactionGuard.issue({
    ...staff,feature:'fulfillment',action:'close',requestId:'TKT-schema11-open',ttlMs:120000
  });
  await assert.rejects(() => s.tickets.legacyAction({ action:'close',token:other.token,context:staff }),/no longer valid/);
  await s.db.run("UPDATE tickets SET channel_status='ACTIVE' WHERE id='TKT-schema11-closed'");
  await assert.rejects(() => s.tickets.getLegacy({ ticketId:'TKT-schema11-closed',context:staff }),/not a legacy/);
  s.advance(120001);
  const expired = await s.dispatch(s.interaction(s.control(view,'close')));
  assert.match(expired.replies[0].content,/no longer valid/);
  assert.equal((await s.repository.get('TKT-schema11-open')).state,'OPEN');
  assert.deepEqual(s.events,[]);
  assert.deepEqual(s.createdChannels,[]);
});

test('legacy management panels fail closed in public log channels and remove all listeners on stop', async t => {
  const s = await setup(t,{ publicLogs:true });
  assert.equal(await s.panels.get('legacy-tickets'),undefined);
  assert(s.logEvents.some(event => event.type === 'discord.panel.restore_failed' && event.data.panel === 'legacy-tickets'));
  await s.feature.stop(s.context);
  assert.equal(s.client.eventNames().length,0);
});
