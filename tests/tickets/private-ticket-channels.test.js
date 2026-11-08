'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const migration004 = require('../../src/migrations/004-tickets');
const migration012 = require('../../src/migrations/012-ticket-channels');
const { createSqliteTicketRepository } = require('../../src/adapters/sqlite/ticket-repository');
const { createSqliteRetentionRepository } = require('../../src/adapters/sqlite/retention-repository');
const { createTicketService } = require('../../src/domain/tickets/ticket-service');
const { createAuthorizationPolicy, authorize } = require('../../src/security/authorization');
const { createTicketChannelGateway } = require('../../src/adapters/discord/ticket-channel-gateway');
const { PermissionFlagsBits, ChannelType } = require('discord.js');

const id = n => `100000000000000${n.toString().padStart(2,'0')}`;
const config = { guildId:id(1), roles:{ staff:id(2) }, channels:{ requests:id(3), ticketLogs:id(4), ticketCategory:id(5) } };
const requester = { actorId:id(6), guildId:id(1), channelId:id(3), roleIds:[] };
const moderator = { actorId:id(7), guildId:id(1), channelId:id(8), roleIds:[id(2)], messageId:id(9) };

async function setup(t) {
  const db = await openSqliteDatabase(':memory:');
  t.after(() => db.close());
  await migration004.up(db);
  for (const sql of migration012.statements) await db.executeSql(sql);
  const repository = createSqliteTicketRepository(db);
  const policy = createAuthorizationPolicy({ guildId:config.guildId, capabilities:{
    'tickets.moderate':{ roleIds:[id(2)],channelIds:[id(3),id(4)] },
    'tickets.channel-moderate':{ roleIds:[id(2)],channelIds:[] }
  } });
  const events = [];
  const calls = [];
  const gateway = {
    create:async () => (calls.push('create'),id(8)), post:async () => id(9),
    sync:async record => { calls.push(record.state); }, remove:async () => calls.push('delete'), find:async () => null
  };
  const service = createTicketService({
    repository, playerNames:{ get:async () => ({ status:'VERIFIED',playerName:'Survivor' }) },
    authorization:{ authorize:(cap,ctx) => authorize(policy,cap,ctx) }, audit:{ write:(type,data) => events.push({ type,data }) },
    uuid:randomUUID, clock:() => 100, channelConfig:config
  });
  service.connectChannels(gateway);
  const create = () => service.create({ type:'SUPPORT',description:'Need help',context:requester,username:'Survivor' });
  return { db,repository,service,gateway,events,calls,create };
}

test('one private request per user is atomic across types and service instances', async t => {
  const s = await setup(t);
  const results = await Promise.allSettled([s.create(),s.create()]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length,1);
  const record = results.find(row => row.status === 'fulfilled').value;
  assert.equal(record.ticketNumber,1);
  assert.equal(record.channelId,id(8));
  assert.equal(record.messageId,id(9));
  assert.equal(s.calls.filter(call => call === 'create').length,1);
  await assert.rejects(() => s.repository.create({
    id:'other',type:'SHOP',description:'x',actorId:requester.actorId,playerName:'Survivor',guildId:id(1),
    channelId:id(3),state:'OPEN',createdAt:100,updatedAt:100,channelStatus:'PROVISIONING'
  }),/open ticket already exists/);
});

test('completion is distinct from archival and requester closure preserves staff-only authorization', async t => {
  const s = await setup(t);
  const record = await s.create();
  const input = { ticketId:record.id,context:moderator };
  await assert.rejects(() => s.service.complete({ ...input,context:{ ...moderator,roleIds:[] } }),/not authorized/);
  const completed = await s.service.complete(input);
  assert.equal(completed.state,'COMPLETED');
  assert.equal(completed.channelStatus,'ACTIVE');
  assert.equal((await s.repository.get(record.id)).state,'COMPLETED');
  assert.equal(await createSqliteRetentionRepository(s.db,{
    beforePurgeClosedTickets:cutoff => s.service.purgeChannels(cutoff)
  }).purgeClosedTickets(200),0);
  await assert.rejects(() => s.service.complete(input),/already completed/);
  await assert.rejects(() => s.service.close({ ...input,context:{ ...moderator,actorId:id(10),roleIds:[] } }),/not authorized/);
  const closed = await s.service.close({ ...input,context:{ ...moderator,actorId:requester.actorId,roleIds:[] } });
  assert.equal(closed.state,'CLOSED');
  assert.equal(closed.channelStatus,'ARCHIVED');
  const reopened = await s.service.reopen(input);
  assert.equal(reopened.state,'OPEN');
  assert.equal(reopened.completedAt,null);
});

test('guild, channel, and ticket-message mismatches are rejected before mutation', async t => {
  const s = await setup(t);
  const record = await s.create();
  for (const context of [
    { ...moderator,guildId:id(11) }, { ...moderator,channelId:id(11) }, { ...moderator,messageId:id(11) }
  ]) await assert.rejects(() => s.service.close({ ticketId:record.id,context }));
  assert.equal((await s.repository.get(record.id)).state,'OPEN');
});

test('deleted channels free the active slot without recreating or reopening the deleted ticket', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.service.channelDeleted(record.channelId,id(11));
  assert.equal((await s.repository.get(record.id)).state,'OPEN');
  await s.service.channelDeleted(record.channelId,id(1));
  assert.equal((await s.repository.get(record.id)).channelStatus,'DELETED');
  await assert.rejects(() => s.service.reopen({ ticketId:record.id,context:moderator }),/unavailable/);
  const next = await s.create();
  assert.equal(next.ticketNumber,2);
});

test('deleted ticket controls are rebound while stale deletion events remain inert', async t => {
  const s = await setup(t);
  const record = await s.create();
  s.gateway.sync = async () => id(14);
  await s.service.controlDeleted(record.messageId,record.channelId,id(11));
  assert.equal((await s.repository.get(record.id)).messageId,id(9));
  await s.service.controlDeleted(record.messageId,record.channelId,id(1));
  assert.equal((await s.repository.get(record.id)).messageId,id(14));
  s.gateway.sync = async () => assert.fail('Old message event must not mutate controls');
  await s.service.controlDeleted(record.messageId,record.channelId,id(1));
});

test('retention deletes the archived Discord channel before dropping its record and preserves failed cleanup', async t => {
  const s = await setup(t);
  const record = await s.create();
  await s.service.close({ ticketId:record.id,context:moderator });
  const retention = createSqliteRetentionRepository(s.db,{ beforePurgeClosedTickets:cutoff => s.service.purgeChannels(cutoff) });
  s.gateway.remove = async () => { throw new Error('Discord unavailable'); };
  assert.equal(await retention.purgeClosedTickets(200),0);
  assert(await s.repository.get(record.id));
  assert(s.events.some(event => event.type === 'ticket.channel_failed'
    && event.data.id === record.id && event.data.phase === 'purge'));
  s.gateway.remove = async () => s.calls.push('delete');
  assert.equal(await retention.purgeClosedTickets(200),1);
  assert.equal(await s.repository.get(record.id),null);
  const next = await s.create();
  assert.equal(next.ticketNumber,2);
});

test('bad ticket channels retain their records while unrelated channel and record-only tickets are purged', async t => {
  const s = await setup(t);
  const rows = [
    ['bad-topic',id(20),'ARCHIVED'],['wrong-guild',id(21),'ARCHIVED'],
    ['missing-access',id(22),'ARCHIVED'],['healthy-channel',id(23),'ARCHIVED'],
    ['already-missing',id(24),'ARCHIVED'],['legacy-record',id(25),null]
  ];
  for (const [ticketId,channelId,status] of rows) {
    await s.db.run(
      `INSERT INTO tickets
       (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at,channel_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [ticketId,'SUPPORT','Archived request',ticketId,'Survivor',id(1),channelId,'CLOSED',1,1,status]
    );
  }
  const deleted = [];
  const channels = new Map([
    [id(20),{ guildId:id(1),topic:'Edited topic' }],
    [id(21),{ guildId:id(30),topic:'Ticketbot V2 request wrong-guild' }],
    [id(23),{ guildId:id(1),topic:'Ticketbot V2 request healthy-channel',
      delete:async () => deleted.push(id(23)) }]
  ]);
  s.service.connectChannels(createTicketChannelGateway({
    config:{ discord:config },client:{ channels:{ fetch:async channelId => {
      if (channelId === id(22)) throw Object.assign(new Error('Missing Access'),{ code:50001 });
      if (channelId === id(24)) throw Object.assign(new Error('Unknown Channel'),{ code:10003 });
      return channels.get(channelId);
    } } }
  }));
  const retention = createSqliteRetentionRepository(s.db,{
    beforePurgeClosedTickets:cutoff => s.service.purgeChannels(cutoff)
  });
  assert.equal(await retention.purgeClosedTickets(200),3);
  assert.deepEqual(deleted,[id(23)]);
  for (const ticketId of ['bad-topic','wrong-guild','missing-access']) {
    assert.equal((await s.repository.get(ticketId)).channelStatus,'ARCHIVED');
    assert(s.events.some(event => event.type === 'ticket.channel_failed'
      && event.data.id === ticketId && event.data.phase === 'purge'));
  }
  for (const ticketId of ['healthy-channel','already-missing','legacy-record']) {
    assert.equal(await s.repository.get(ticketId),null);
  }
  assert(!JSON.stringify(s.events).includes('Missing Access'));
  assert.equal(await retention.purgeClosedTickets(200),0);
});

test('reopening cannot bypass a newer active private request', async t => {
  const s = await setup(t);
  const first = await s.create();
  await s.service.close({ ticketId:first.id,context:moderator });
  s.gateway.create = async () => id(15);
  const second = await s.create();
  await assert.rejects(() => s.service.reopen({ ticketId:first.id,context:moderator }));
  assert.equal((await s.repository.get(first.id)).state,'CLOSED');
  assert.equal((await s.repository.get(second.id)).state,'OPEN');
});

test('failed and interrupted provisioning are recoverable without allocating duplicate channels', async t => {
  const s = await setup(t);
  s.gateway.create = async () => { throw new Error('Missing permission'); };
  await assert.rejects(s.create,/Missing permission/);
  assert.equal(await s.repository.findActive(id(1),requester.actorId),null);
  s.gateway.create = async () => id(8);
  const record = await s.create();
  assert.equal(record.ticketNumber,2);
  await s.db.run("UPDATE tickets SET message_id=NULL WHERE id=?",[record.id]);
  await s.service.recoverChannels();
  assert.equal((await s.repository.get(record.id)).messageId,id(9));
});

test('gateway creates explicit private overwrites and archives without deleting', async () => {
  let options;
  let overwriteRows;
  let renamed;
  const record = { id:'TKT-test',actorId:id(6),channelId:id(8),ticketNumber:1,state:'OPEN' };
  const channel = {
    id:id(8),guildId:id(1),topic:'Ticketbot V2 request TKT-test',name:'player-1',
    permissionOverwrites:{ set:async rows => { overwriteRows = rows; } },
    setName:async name => { renamed = name; }, messages:{ fetch:async () => new Map() }
  };
  const client = { user:{ id:id(12) }, channels:{ fetch:async () => channel },guilds:{ fetch:async () => ({
    channels:{ fetch:async () => ({ id:id(5),guildId:id(1),type:ChannelType.GuildCategory }),
      create:async value => (options = value,channel) }
  }) } };
  const gateway = createTicketChannelGateway({ client,config:{ discord:config } });
  assert.equal(await gateway.create(record,'Test User'),id(8));
  assert.equal(options.name,'testuser-1');
  assert.deepEqual(options.permissionOverwrites.find(row => row.id === id(1)).deny,[PermissionFlagsBits.ViewChannel]);
  assert(options.permissionOverwrites.find(row => row.id === id(2)).allow.includes(PermissionFlagsBits.SendMessages));
  await gateway.sync({ ...record,state:'CLOSED' });
  assert.deepEqual(overwriteRows.find(row => row.id === id(6)).deny,[PermissionFlagsBits.ViewChannel]);
  assert.equal(renamed,'closed-1-player-1');
});
