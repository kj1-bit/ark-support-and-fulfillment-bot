'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteTicketRepository } = require('../../src/adapters/sqlite/ticket-repository');
const { composeRuntime } = require('../../src/composition/compose-runtime');

const names = ['v2-core','trusted-state','player-names','tickets','pins','operational-events',
  'fulfillment-targets','trusted-identity-associations','discord-panels','fulfillment-result-redaction',
  'schema-integrity','ticket-channels','vault-pins','mock-ticket-multiplicity','remembered-players','approve-existing-links'];
const migrations = names.map((name,index) => require(`../../src/migrations/${String(index + 1).padStart(3,'0')}-${name}`));
const id = n => `1000000000000${String(n).padStart(4,'0')}`;
const discord = { guildId:id(1),roles:{ staff:id(2) },
  channels:{ requests:id(3),ticketLogs:id(4),ticketCategory:id(5),playerNames:id(3),pinsDashboard:id(8) } };
const requester = { actorId:id(6),guildId:id(1),channelId:id(3),roleIds:[] };
const moderator = record => ({
  actorId:id(7),guildId:id(1),channelId:record.channelId,messageId:record.messageId,roleIds:[id(2)]
});
const catalog = { version:'2026.1.0',creatures:[{ id:'achatina',name:'Achatina',aliases:[],
  blueprint:'/Game/Achatina.Achatina',enabled:true,tameable:true,deliveryMode:'single',
  supportsGender:false,saddleApplicable:false }] };

async function setup(t, schema = 14) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'ticket-mode-'));
  const database = await openSqliteDatabase(path.join(directory,'test.sqlite'));
  const connections = [database];
  t.after(async () => {
    for (const connection of connections) await connection.close();
    await rm(directory,{ recursive:true,force:true });
  });
  await createMigrationRunner({ database,migrations:migrations.slice(0,schema) }).run();
  const channels = new Map(), audit = [];
  let nextId = 100;
  async function runtime(mode, secondConnection = false) {
    const connection = secondConnection ? await openSqliteDatabase(path.join(directory,'test.sqlite')) : database;
    if (secondConnection) connections.push(connection);
    const value = await composeRuntime({
      config:Object.freeze({ runtime:{ mode },discord,ark:{ servers:[{
        id:'unused',name:'Unused Test Server',host:'127.0.0.1',port:27020,passwordSecret:'UNUSED',
        enabled:true,testOnly:true,operations:['listOnlinePlayers','fulfillApprovedCreature']
      }] },
        features:{ tickets:true,playerNames:true } }),
      database:connection,catalog,randomUUID,auditSink:event => audit.push(event),
      transport:{ execute:async () => assert.fail('Ticket modes must not change or use RCON') },
      buildFulfillmentPlan:() => assert.fail('Tickets must not build fulfillment operations')
    });
    const gateway = {
      verify:async () => {},
      create:async record => {
        const channelId = id(nextId++);
        channels.set(channelId,{ ticketId:record.id });
        return channelId;
      },
      post:async () => id(nextId++),
      sync:async record => {
        const channel = channels.get(record.channelId);
        assert(channel);
        channel.state = record.state;
        if (!record.messageId) return id(nextId++);
      }
    };
    value.tickets.connectChannels(gateway);
    return { ...value,gateway,connection };
  }
  async function verifyPlayer(value) {
    const request = await value.playerNames.submit({ discordId:requester.actorId,playerName:'Survivor' });
    await value.playerLinks.link({ discordId:requester.actorId,eosId:'a'.repeat(32),
      displayName:'Survivor',source:'manual',actorId:id(7),request });
  }
  const create = value => value.tickets.create({
    type:'SUPPORT',description:'Test request',username:'Survivor',context:requester
  });
  const close = (value,record) => value.tickets.close({ ticketId:record.id,context:moderator(record) });
  const reopen = (value,record) => value.tickets.reopen({ ticketId:record.id,context:moderator(record) });
  return { database,channels,audit,runtime,verifyPlayer,create,close,reopen };
}

test('composed mock mode permits concurrent same-requester tickets across SQLite connections with unique channels and durable numbers', async t => {
  const s = await setup(t);
  const first = await s.runtime('mock');
  await s.verifyPlayer(first);
  const second = await s.runtime('mock',true);
  const records = await Promise.all(Array.from({ length:6 },(_,index) => s.create(index % 2 ? first : second)));
  assert.equal(new Set(records.map(record => record.id)).size,6);
  assert.equal(new Set(records.map(record => record.channelId)).size,6);
  assert.equal(new Set(records.map(record => record.messageId)).size,6);
  assert.deepEqual(records.map(record => record.ticketNumber).sort((a,b) => a - b),[1,2,3,4,5,6]);
  assert(records.every(record => record.mock_multiple === 1 && record.channelStatus === 'ACTIVE'));
  assert.equal((await first.tickets.openSnapshot()).total,6);
  const originalNumber = records[0].ticketNumber;
  await s.close(first,records[0]);
  await s.reopen(first,records[0]);
  assert.equal((await s.database.get('SELECT ticket_number FROM tickets WHERE id=?',[records[0].id])).ticket_number,originalNumber);
  await assert.rejects(s.reopen(first,records[0]),/transition is invalid/);
  const restarted = await s.runtime('mock');
  assert.equal((await s.create(restarted)).ticketNumber,7);
});

for (const mode of ['test','production',undefined,'MOCK','mock ']) {
  test(`mode ${String(mode)} keeps single-active atomic protection across SQLite connections`, async t => {
    const s = await setup(t);
    const first = await s.runtime(mode);
    await s.verifyPlayer(first);
    const second = await s.runtime(mode,true);
    const attempts = await Promise.allSettled([s.create(first),s.create(second),s.create(first),s.create(second)]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length,1);
    assert.equal(s.channels.size,1);
    const record = attempts.find(result => result.status === 'fulfilled').value;
    assert.equal(record.mock_multiple,0);
    assert.equal(record.ticketNumber,1);
    await assert.rejects(s.create(second),/already have an open request/);
    const repository = createSqliteTicketRepository(second.connection,{ mode });
    await assert.rejects(repository.create({
      id:'bypass-service',type:'SHOP',description:'x',actorId:requester.actorId,playerName:'Survivor',
      guildId:id(1),channelId:id(3),state:'OPEN',channelStatus:'PROVISIONING',createdAt:1,updatedAt:1
    }),/open ticket already exists/);
  });
}

test('non-mock mode preserves multiple mock records and channels, blocks new creates/reopens, and permits normal moderation', async t => {
  const s = await setup(t);
  const mock = await s.runtime('mock');
  await s.verifyPlayer(mock);
  const first = await s.create(mock);
  const second = await s.create(mock);
  const before = await s.database.all('SELECT * FROM tickets ORDER BY id');
  const real = await s.runtime('test',true);
  assert.deepEqual(await s.database.all('SELECT * FROM tickets ORDER BY id'),before);
  assert.equal(s.channels.size,2);
  await assert.rejects(s.create(real),/already have an open request/);
  await real.tickets.claim({ ticketId:second.id,context:moderator(second) });
  await real.tickets.complete({ ticketId:second.id,context:moderator(second) });
  await s.close(real,first);
  await assert.rejects(s.reopen(real,first),/transition is invalid/);
  assert.equal((await s.database.get('SELECT state FROM tickets WHERE id=?',[first.id])).state,'CLOSED');
  await s.close(real,second);
  const next = await s.create(real);
  assert.equal(next.ticketNumber,3);
  assert.equal(next.mock_multiple,0);
  await assert.rejects(s.reopen(real,first),/transition is invalid/);
  await s.close(real,next);
  const reopened = await s.reopen(real,first);
  assert.equal(reopened.ticketNumber,first.ticketNumber);
  assert.equal(reopened.mock_multiple,0,'a real-mode reopen must restore the ordinary database guard');
  await assert.rejects(s.create(real),/already have an open request/);
  assert.equal(s.channels.size,3,'mode switching must never delete retained channels');
});

test('non-mock reopen/create and two-reopen races cannot add a second active ticket even from mock-created rows', async t => {
  const s = await setup(t);
  const mock = await s.runtime('mock');
  await s.verifyPlayer(mock);
  const records = [await s.create(mock),await s.create(mock)];
  for (const record of records) await s.close(mock,record);
  const first = await s.runtime('production');
  const second = await s.runtime('production',true);
  const reopened = await Promise.allSettled([s.reopen(first,records[0]),s.reopen(second,records[1])]);
  assert.equal(reopened.filter(result => result.status === 'fulfilled').length,1);
  const active = reopened.find(result => result.status === 'fulfilled').value;
  await s.close(first,active);
  const race = await Promise.allSettled([s.reopen(first,records[0]),s.create(second)]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length,1);
  assert.equal((await s.database.get("SELECT COUNT(*) AS count FROM tickets WHERE state IN ('OPEN','CLAIMED')")).count,1);
});

test('provisioning/message retries obey current mode and failed reservations do not reuse durable ticket numbers', async t => {
  const s = await setup(t);
  const mock = await s.runtime('mock');
  await s.verifyPlayer(mock);
  const create = mock.gateway.create;
  mock.gateway.create = async () => { throw new Error('test provisioning failure'); };
  await assert.rejects(s.create(mock),/provisioning failure/);
  mock.gateway.create = create;
  const second = await s.create(mock);
  assert.equal(second.ticketNumber,2);
  const post = mock.gateway.post;
  mock.gateway.post = async () => { throw new Error('test message failure'); };
  await assert.rejects(s.create(mock),/message failure/);
  mock.gateway.post = post;
  const real = await s.runtime('test');
  await assert.rejects(s.create(real),/already have an open request/);
  const fourth = await s.create(mock);
  assert.equal(fourth.ticketNumber,4);
  const retained = await s.database.all('SELECT * FROM tickets ORDER BY ticket_number');
  assert.deepEqual(retained.map(record => record.ticket_number),[1,2,3,4]);
  assert.equal(retained[0].channel_status,'FAILED');
  assert.equal(retained[2].message_id,null);
  await mock.tickets.recoverChannels();
  assert((await s.database.get('SELECT message_id FROM tickets WHERE ticket_number=3')).message_id);
  assert.equal((await s.database.get('SELECT value FROM ticket_counter WHERE id=1')).value,4);
  assert.equal(s.channels.size,3);
});

test('non-mock honors in-flight mock reservations and retries a failed reopen sync without another transition', async t => {
  const s = await setup(t);
  const mock = await s.runtime('mock');
  await s.verifyPlayer(mock);
  const real = await s.runtime('test',true);
  let release, entered;
  const reserved = new Promise(resolve => { entered = resolve; });
  const proceed = new Promise(resolve => { release = resolve; });
  const create = mock.gateway.create;
  mock.gateway.create = async record => {
    entered();
    await proceed;
    return create(record);
  };
  const pending = s.create(mock);
  await reserved;
  assert.equal((await s.database.get("SELECT channel_status FROM tickets WHERE state='OPEN'")).channel_status,'PROVISIONING');
  await assert.rejects(s.create(real),/already have an open request/);
  release();
  const record = await pending;
  await s.close(real,record);
  const sync = real.gateway.sync;
  real.gateway.sync = async () => { throw new Error('test reopen sync failure'); };
  await assert.rejects(s.reopen(real,record),/reopen sync failure/);
  await assert.rejects(s.create(real),/already have an open request/);
  const row = await s.database.get('SELECT * FROM tickets WHERE id=?',[record.id]);
  assert.equal(row.state,'OPEN');
  assert.equal(row.channel_status,'ARCHIVED');
  real.gateway.sync = sync;
  const retried = await s.reopen(real,record);
  assert.equal(retried.channelStatus,'ACTIVE');
  assert.equal(retried.ticketNumber,record.ticketNumber);
  assert.equal(s.audit.filter(event => event.type === 'ticket.reopened').length,1);
  assert.equal((await s.database.get('SELECT COUNT(*) AS count FROM tickets')).count,1);
});

test('schema-13 forward upgrade preserves rows, saved panels, PINs and numbering while keeping ordinary uniqueness enabled', async t => {
  const s = await setup(t,13);
  await s.database.run(
    `INSERT INTO tickets
     (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at,channel_status,completed_at,message_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['existing','SUPPORT','Original request',requester.actorId,'Survivor',id(1),id(90),'CLAIMED',1,2,'ACTIVE',3,id(91)]);
  await s.database.run("INSERT INTO discord_panel_messages VALUES ('open-tickets','logs','panel',2)");
  await s.database.run("INSERT INTO vault_pins VALUES ('guild','user','sealed','SELF_SERVICE',1,2,NULL)");
  const before = await s.database.get("SELECT * FROM tickets WHERE id='existing'");
  const panels = await s.database.all('SELECT * FROM discord_panel_messages');
  const pins = await s.database.all('SELECT * FROM vault_pins');
  const real = await s.runtime('test');
  assert.equal(real.schemaVersion,16);
  const after = await s.database.get("SELECT * FROM tickets WHERE id='existing'");
  for (const [key,value] of Object.entries(before)) assert.equal(after[key],value);
  assert.equal(after.mock_multiple,0);
  assert.deepEqual(await s.database.all('SELECT * FROM discord_panel_messages'),panels);
  assert.deepEqual(await s.database.all('SELECT * FROM vault_pins'),pins);
  assert.equal(await createMigrationRunner({ database:s.database,migrations }).run(),16);
  await s.verifyPlayer(real);
  await assert.rejects(s.create(real),/already have an open request/);
  const mock = await s.runtime('mock');
  const additional = await s.create(mock);
  assert.equal(additional.ticketNumber,2);
  await assert.rejects(s.database.run(
    `INSERT INTO tickets
     (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at,channel_status)
     VALUES ('raw','SUPPORT','x',?,'Survivor',?,?,'OPEN',1,1,'PROVISIONING')`,
    [requester.actorId,id(1),id(3)]),/UNIQUE/);
});
