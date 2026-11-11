'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { composeRuntime } = require('../../src/composition/compose-runtime');
const { startV2 } = require('../../src/composition/start-v2');
const { createFulfillmentController } = require('../../src/adapters/discord/fulfillment-controller');
const { createDiscordRouter } = require('../../src/adapters/discord/router');
const { createPlayerRegistry } = require('../../src/registries/player-registry');
const { createPlayerObserver } = require('../../src/application/player-observer');
const views = require('../../src/adapters/discord/fulfillment-view');

const id = n => `100000000000000${String(n).padStart(2, '0')}`;
const eos = 'a'.repeat(32);
const target = id(6), actor = id(1), guild = id(2), channel = id(3), message = id(4), panel = id(5), role = id(7);
const component = (view, label) => view.components.flatMap(row => row.components)
  .find(item => item.label === label || item.placeholder === label);
function interaction(kind, customId, values = [], extra = {}) {
  const i = { user:{ id:actor }, guildId:guild, channelId:channel, message:{ id:message },
    member:{ roleIds:[role] }, customId, values,
    isButton:() => kind === 'button', isStringSelectMenu:() => kind === 'select',
    isUserSelectMenu:() => kind === 'member', isModalSubmit:() => kind === 'modal',
    deferReply:async () => { i.deferred = true; }, deferUpdate:async () => { i.deferred = true; },
    editReply:async payload => ({ ...payload,id:message }), reply:async payload => payload,
    followUp:async payload => payload, showModal:async modal => modal.toJSON(), ...extra };
  return i;
}
async function setup(t) {
  const database = await openSqliteDatabase(':memory:');
  t.after(() => database.close());
  let online = [{ eosId:eos,displayName:'Remembered Survivor' }];
  const operations = [], events = [];
  let now = 100;
  const config = Object.freeze({
    features:{ playerNames:true,fulfillment:true },
    discord:{ guildId:guild,roles:{ staff:role,fulfillmentModerator:role },
      channels:{ playerNames:channel,pinsDashboard:channel,fulfillment:channel } },
    ark:{ servers:[{ id:'map-one',name:'Map One',enabled:true,testOnly:true,host:'127.0.0.1',
      port:27020,passwordSecret:'UNUSED',operations:['listOnlinePlayers','fulfillApprovedCreature'] }] }
  });
  const runtime = await composeRuntime({ config,database,clock:() => now,randomUUID,
    catalog:{ version:'2026.1.0',creatures:[{ id:'rex',name:'Rex',aliases:[],blueprint:'/Game/Rex.Rex',
      enabled:true,tameable:true,deliveryMode:'single',supportsGender:false,saddleApplicable:false }] },
    transport:{ execute:async input => {
      operations.push(input.type);
      return input.type === 'listOnlinePlayers' ? online : { success:true };
    } },
    buildFulfillmentPlan:() => [{ command:'test-only' }],auditSink:event => events.push(event) });
  const controller = createFulfillmentController({ services:runtime });
  const router = createDiscordRouter({ controller,views,config,logSink:async event => events.push(event),
    playerPanelMatches:i => i.message?.id === panel && i.guildId === guild && i.channelId === channel });
  return { database,runtime,controller,router,operations,events,
    online:value => { online = value; },time:value => { now = value; } };
}
async function members(s, unlink = false) {
  return s.router.handle(interaction('button', `v2:player-name:${unlink ? 'unlink' : 'link'}`,
    [], { message:{ id:panel } }));
}
async function chooseMember(s, unlink = false, discordId = target) {
  const view = await members(s, unlink);
  return s.router.handle(interaction('member', component(view, 'Select a Discord member').custom_id, [discordId]));
}
async function manual(s, displayName = 'Manual Survivor', eosId = 'b'.repeat(32), discordId = target) {
  const players = await chooseMember(s, false, discordId);
  const modal = await s.router.handle(interaction('button', component(players, 'Enter Player Manually').custom_id));
  return s.router.handle(interaction('modal', modal.custom_id, [], {
    fields:{ getTextInputValue:key => key === 'player-name' ? displayName : eosId }
  }));
}

test('real schema 14 upgrades to 15 without losing any existing table rows and seeds trusted identities', async t => {
  const database = await openSqliteDatabase(':memory:');
  t.after(() => database.close());
  const dir = path.join(__dirname, '../../src/migrations');
  const migrations = fs.readdirSync(dir).filter(name => /^\d{3}-/.test(name)).sort().map(name => require(path.join(dir,name)));
  await createMigrationRunner({ database,migrations:migrations.filter(m => m.version <= 14) }).run();
  await database.run(`INSERT INTO trusted_players VALUES (?,?,?,?,?)`, [target,eos,'Existing Survivor',100,'manual']);
  await database.run(`INSERT INTO trusted_players VALUES (?,?,?,?,?)`, [id(8),'B'.repeat(32),'Uppercase Survivor',200,'manual']);
  await database.run(`INSERT INTO trusted_players VALUES (?,?,?,?,?)`, [id(9),'unexpected-legacy','Invalid Survivor',300,'manual']);
  await database.run(`INSERT INTO trusted_players VALUES (?,?,?,?,?)`, [id(10),'A'.repeat(32),'Older Case Duplicate',50,'manual']);
  await database.run(`INSERT INTO trusted_players VALUES (?,?,?,?,?)`, [id(11),'g'.repeat(32),'Nonhex Survivor',400,'manual']);
  await database.run(`INSERT INTO player_names (discord_id,player_name,status,updated_at)
    VALUES (?,?,?,?)`, [target,'Existing Survivor','PENDING',100]);
  const tables = await database.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_versions'");
  const before = new Map();
  for (const { name } of tables) before.set(name, await database.all(`SELECT * FROM "${name}"`));
  assert.equal(await createMigrationRunner({ database,migrations:migrations.filter(m => m.version <= 15) }).run(),15);
  for (const [name,rows] of before) assert.deepEqual(await database.all(`SELECT * FROM "${name}"`), rows);
  assert.deepEqual(await database.all('SELECT * FROM remembered_players ORDER BY eos_id'), [{
    eos_id:eos,display_name:'Existing Survivor',server_id:'previous-link',last_seen_at:100
  }, {
    eos_id:'b'.repeat(32),display_name:'Uppercase Survivor',server_id:'previous-link',last_seen_at:200
  }]);
  assert.equal(await createMigrationRunner({ database,migrations:migrations.filter(m => m.version <= 15) }).run(),15);
  assert.equal((await database.all('SELECT * FROM remembered_players')).length,2);
});

test('remembered identities persist, deduplicate across maps, and page newest first while offline', async t => {
  const s = await setup(t);
  for (let n = 1; n <= 27; n++) {
    s.time(n);
    s.online([{ eosId:n.toString(16).padStart(32,'0'),displayName:'Survivor ' + n }]);
    await s.runtime.onlinePlayers.observe('map-one');
  }
  s.time(50);
  s.online([{ eosId:'1'.padStart(32,'0'),displayName:'Renamed Survivor' }]);
  await s.runtime.onlinePlayers.observe('map-one');
  s.online([]);
  const context = { actorId:actor,guildId:guild,channelId:channel };
  const first = await s.runtime.onlinePlayers.scanPage({ context,remembered:true,page:1 });
  const second = await s.runtime.onlinePlayers.scanPage({ context,remembered:true,page:2 });
  assert.equal(first.players.length,25);
  assert.equal(first.players[0].displayName,'Renamed Survivor');
  assert.equal(second.players.length,2);
  assert.equal(s.operations.length,28);
  assert.throws(() => s.runtime.onlinePlayers.resolve(first.players[0].playerRef,context), /not verified/);
});

test('failed observation persistence does not prevent fulfillment and unlink invalidates a prior scan', async t => {
  const s = await setup(t);
  const request = await s.runtime.playerNames.submit({ discordId:target,playerName:'Trusted Survivor' });
  await s.runtime.playerLinks.link({ discordId:target,eosId:eos,displayName:'Trusted Survivor',
    source:'manual',actorId:actor,request });
  s.online([{ eosId:eos,displayName:'Renamed Survivor' }]);
  await s.database.executeSql("CREATE TRIGGER reject_remember BEFORE INSERT ON remembered_players BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY private observation failure'); END");
  const i = interaction('select','');
  const scan = await s.controller.scanPage(i,{ serverIds:['map-one'] });
  assert.equal(scan.players[0].displayName,'Renamed Survivor');
  const selection = { playerRef:scan.players[0].playerRef,serverId:'map-one',eosId:eos };
  assert.equal((await s.runtime.onlinePlayers.revalidate(selection)).online,true);
  const next = await s.controller.scanPage(i,{ serverIds:['map-one'] });
  const pending = await s.controller.begin(i,{ playerRef:next.players[0].playerRef,serverId:'map-one',
    creatureId:'rex',ttlMs:120000,idempotencyKey:randomUUID() });
  assert.equal((await s.controller.confirm(i,{ token:pending.token })).state,'SUCCEEDED');
  assert(s.events.some(event => event.type === 'player-observation.persistence-failed'));
  assert(!JSON.stringify(s.events.filter(event => event.type === 'player-observation.persistence-failed')).includes(eos));
  const last = await s.controller.scanPage(i,{ serverIds:['map-one'] });
  await s.runtime.playerLinks.unlink({ discordId:target,eosId:eos,actorId:actor });
  await assert.rejects(s.controller.begin(i,{ playerRef:last.players[0].playerRef,serverId:'map-one',creatureId:'rex' }),/not verified/);
});

test('observer checks only enabled allowlisted maps sequentially, logs failures and drains on stop', async () => {
  let callback, cleared = false, release, calls = [], events = [];
  const wait = new Promise(resolve => { release = resolve; });
  const observer = createPlayerObserver({
    onlinePlayers:{ observe:async serverId => { calls.push(serverId); if (serverId === 'one') await wait; else throw new Error('private'); } },
    servers:[{ id:'one',enabled:true,operations:['listOnlinePlayers'] },
      { id:'two',enabled:true,operations:['listOnlinePlayers'] },
      { id:'disabled',enabled:false,operations:['listOnlinePlayers'] },{ id:'not-allowlisted',enabled:true,operations:[] }],
    audit:{ write:(type,data) => events.push({ type,data }) },
    setIntervalFn:(fn,delay) => { callback = fn; assert.equal(delay,180000); return 1; },
    clearIntervalFn:() => { cleared = true; }
  });
  observer.start();
  assert.deepEqual(calls,['one']);
  const first = observer.runOnce();
  assert.equal(observer.runOnce(),first);
  release();
  await first;
  assert.deepEqual(calls,['one','two']);
  assert.deepEqual(events,[{ type:'player-observation.failed',data:{ serverId:'two' } }]);
  callback();
  const stopping = observer.stop();
  await stopping;
  assert(cleared);
  assert.deepEqual(calls,['one','two','one']);
  await observer.runOnce();
  assert.equal(calls.length,3);
});

test('startup starts observation only after Discord is ready and stops it before closing SQLite', async () => {
  const order = [];
  const service = await startV2({
    loadConfig:() => ({ schemaVersion:1,runtime:{ mode:'mock',environment:'test',logLevel:'info' },
      discord:{ roles:{},channels:{} },ark:{ servers:[] },features:{},storage:{} }),
    openDatabase:async () => ({ close:async () => order.push('database-close') }),
    composeRuntime:async () => ({ playerObserver:{ start:() => order.push('observer-start'),stop:async () => order.push('observer-stop') } }),
    createDiscordAdapter:async () => ({ start:async () => order.push('discord-start'),stop:async () => order.push('discord-stop') })
  });
  await service.stop();
  assert.deepEqual(order,['discord-start','observer-start','observer-stop','discord-stop','database-close']);
});
