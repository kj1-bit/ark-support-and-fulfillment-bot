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
      channels:{ playerNames:channel,fulfillment:channel } },
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
  assert.equal(await createMigrationRunner({ database,migrations }).run(),15);
  for (const [name,rows] of before) assert.deepEqual(await database.all(`SELECT * FROM "${name}"`), rows);
  assert.deepEqual(await database.all('SELECT * FROM remembered_players ORDER BY eos_id'), [{
    eos_id:eos,display_name:'Existing Survivor',server_id:'previous-link',last_seen_at:100
  }, {
    eos_id:'b'.repeat(32),display_name:'Uppercase Survivor',server_id:'previous-link',last_seen_at:200
  }]);
  assert.equal(await createMigrationRunner({ database,migrations }).run(),15);
  assert.equal((await database.all('SELECT * FROM remembered_players')).length,2);
});

test('remembered identities persist, deduplicate across maps, and page newest first while offline', async t => {
  const s = await setup(t);
  for (let n = 1; n <= 27; n++) {
    s.time(n);
    s.online([{ eosId:n.toString(16).padStart(32,'0'),displayName:`Survivor ${n}` }]);
    await s.runtime.onlinePlayers.observe('map-one');
  }
  s.time(50);
  s.online([{ eosId:'1'.padStart(32,'0'),displayName:'Renamed Survivor' }]);
  await s.runtime.onlinePlayers.observe('map-one');
  s.online([]);
  const first = await chooseMember(s);
  assert.equal(component(first,'Select a map'),undefined);
  const menu = component(first,'Select a remembered player');
  assert.equal(menu.options.length,25);
  assert.equal(menu.options[0].label,'Renamed Survivor');
  assert.equal(menu.options[0].description,'EOS 0000…0001 - Last seen: Map One');
  const second = await s.router.handle(interaction('button',component(first,'Next').custom_id));
  assert.equal(component(second,'Select a remembered player').options.length,2);
  assert.equal(component(second,'Next').disabled,true);
  assert.equal((await s.runtime.rememberedPlayers.page()).total,27);
  assert.equal(s.operations.length,28); // Only the explicit observation calls, never the linking pages.
  const selected = menu.options[0];
  assert.notEqual(selected.value,'1'.padStart(32,'0'));
  const context = { actorId:actor,guildId:guild,channelId:channel };
  assert.throws(() => s.runtime.onlinePlayers.resolve(selected.value,context), /not verified/);
});

test('remembered options show linked status privately and readable seeded or unknown map labels', async t => {
  const s = await setup(t);
  await s.controller.associateManual(interaction('modal',''),{
    discordId:target,eosId:eos,displayName:'Linked Survivor'
  });
  await s.runtime.rememberedPlayers.remember({
    eosId:eos,displayName:'Linked Survivor',serverId:'previous-link',lastSeenAt:100
  });
  await s.runtime.rememberedPlayers.remember({
    eosId:'b'.repeat(32),displayName:'Retired Map Survivor',serverId:'retired-map',lastSeenAt:50
  });
  const linked = await chooseMember(s,false,id(8));
  const options = component(linked,'Select a remembered player').options;
  assert.equal(options[0].description,'EOS aaaa…aaaa - Already linked');
  assert.equal(options[1].description,'EOS bbbb…bbbb - Last seen: retired-map');
  assert(!JSON.stringify(options).includes(target));
  await s.controller.unlink(interaction('button',''),{ discordId:target,eosId:eos });
  const unlinked = await chooseMember(s,false,id(8));
  assert.equal(component(unlinked,'Select a remembered player').options[0].description,'EOS aaaa…aaaa - Previously linked');
});

test('failed remember writes cannot fail live fulfillment scans, revalidation or confirmation', async t => {
  const s = await setup(t);
  const i = interaction('select','');
  await s.controller.associateManual(i,{ discordId:target,eosId:eos,displayName:'Trusted Survivor' });
  s.online([{ eosId:eos,displayName:'Trusted Survivor' },{ eosId:'b'.repeat(32),displayName:'Untrusted Survivor' }]);
  await s.database.executeSql(`CREATE TRIGGER reject_remember BEFORE INSERT ON remembered_players
    BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY private observation failure'); END`);
  const scan = await s.controller.scanPage(i,{ serverIds:['map-one'] });
  assert.equal(scan.total,1);
  assert.equal((await s.runtime.onlinePlayers.revalidate({
    playerRef:scan.players[0].playerRef,serverId:'map-one',eosId:eos
  })).online,true);
  const next = await s.controller.scanPage(i,{ serverIds:['map-one'] });
  const pending = await s.controller.begin(i,{ playerRef:next.players[0].playerRef,serverId:'map-one',
    creatureId:'rex',ttlMs:120000,idempotencyKey:randomUUID() });
  assert.equal((await s.controller.confirm(i,{ token:pending.token })).state,'SUCCEEDED');
  assert.equal(s.operations.filter(type => type === 'fulfillApprovedCreature').length,1);
  const events = s.events.filter(event => event.type === 'player-observation.persistence-failed');
  assert.equal(events.length,4);
  for (const event of events) assert.deepEqual(event.data,{ serverId:'map-one' });
  assert(!JSON.stringify(events).includes('Survivor'));
  assert(!JSON.stringify(events).includes(eos));
  assert(!JSON.stringify(events).includes('private'));
  assert.equal((await s.runtime.rememberedPlayers.page()).total,0);
});

test('real SQLite offline link goes member -> player, persists and reloads without a map or online scan', async t => {
  const s = await setup(t);
  await s.runtime.onlinePlayers.observe('map-one');
  s.online([]);
  const players = await chooseMember(s);
  const menu = component(players,'Select a remembered player');
  const done = await s.router.handle(interaction('select',menu.custom_id,[menu.options[0].value]));
  assert.match(done.content,/Linked in-game identity/);
  assert.equal(s.operations.length,1);
  assert.equal(s.runtime.players.byDiscord(target).eosId,eos);
  const persisted = await s.runtime.playerRepository.list();
  assert.equal(persisted[0].source,'observed:map-one');
  assert.equal(createPlayerRegistry(persisted).byEos(eos).discordId,target);
  assert.equal((await s.controller.scanPage(interaction('select',''),{ serverIds:['map-one'] })).total,0);
  const replay = await s.router.handle(interaction('select',menu.custom_id,[menu.options[0].value]));
  assert.equal(replay.flags,64);
  assert.equal((await s.runtime.playerRepository.list()).length,1);
});

test('manual entry links a never-observed identity with normalized name and strict EOS validation', async t => {
  const s = await setup(t);
  for (const bad of ['', 'a'.repeat(31), 'g'.repeat(32), `${'a'.repeat(32)} `, `${'a'.repeat(32)}\n`, 'a'.repeat(33)]) {
    const result = await manual(s,'Manual Survivor',bad);
    assert.equal(result.content,'EOS ID must contain exactly 32 hexadecimal characters.');
    assert.equal(s.runtime.players.byDiscord(target),null);
  }
  for (const bad of ['x','<@123>','bad\nname','x'.repeat(33),'   ']) {
    const result = await manual(s,bad);
    assert.equal(result.content,'Player name contains unsupported characters or length.');
  }
  const done = await manual(s,'  Manual   Survivor  ','B'.repeat(32));
  assert.match(done.content,/Manual Survivor/);
  assert.equal(s.runtime.players.byDiscord(target).eosId,'b'.repeat(32));
  assert.equal((await s.runtime.playerRepository.list())[0].source,'manual');
  assert.equal(s.operations.length,0);
});

test('already-linked member and duplicate EOS are blocked clearly without changing SQLite or runtime state', async t => {
  const s = await setup(t);
  await manual(s);
  const original = await s.runtime.playerRepository.list();
  const blocked = await chooseMember(s);
  assert.equal(blocked.content,'This Discord member is already linked. Use Unlink Player first, then link again.');
  const duplicate = await manual(s,'Another Survivor','B'.repeat(32),id(8));
  assert.equal(duplicate.content,'This in-game identity is already linked. Use Unlink Player on its current Discord member first.');
  await assert.rejects(s.controller.associateManual(interaction('modal',''),{
    discordId:target,eosId:'c'.repeat(32),displayName:'Replacement'
  }), { code:'PLAYER_ALREADY_LINKED' });
  assert.deepEqual(await s.runtime.playerRepository.list(),original);
  assert.equal(s.runtime.players.byDiscord(id(8)),null);
  assert.deepEqual(s.runtime.players.list(),original);
});

test('unlink confirmation masks EOS, cancels safely, then removes only the link and permits relinking', async t => {
  const s = await setup(t);
  await s.runtime.playerNames.submit({ discordId:target,playerName:'Submitted Name' });
  await manual(s);
  const name = await s.runtime.playerNames.get(target);
  const review = await chooseMember(s,true);
  assert.match(review.content,/EOS ID: bbbb…bbbb/);
  assert(!review.content.includes('b'.repeat(32)));
  assert.equal(component(review,'Confirm Unlink').style,4);
  await s.router.handle(interaction('button',component(review,'Cancel').custom_id));
  assert(s.runtime.players.byDiscord(target));
  const again = await chooseMember(s,true);
  const done = await s.router.handle(interaction('button',component(again,'Confirm Unlink').custom_id));
  assert.match(done.content,/Unlinked in-game identity/);
  assert.equal(s.runtime.players.byDiscord(target),null);
  assert.equal(s.runtime.players.byEos('b'.repeat(32)),null);
  assert.deepEqual(await s.runtime.playerRepository.list(),[]);
  assert.deepEqual(await s.runtime.playerNames.get(target),name);
  await manual(s,'Correct Survivor','c'.repeat(32));
  assert.equal(createPlayerRegistry(await s.runtime.playerRepository.list()).byDiscord(target).displayName,'Correct Survivor');
  const stale = await s.router.handle(interaction('button',component(again,'Confirm Unlink').custom_id));
  assert.equal(stale.flags,64);
  assert.equal(s.runtime.players.byDiscord(target).eosId,'c'.repeat(32));
  assert(s.events.some(e => e.type === 'player-link.removed'));
});

test('stale unlink confirmation cannot delete a replacement link', async t => {
  const s = await setup(t);
  await manual(s);
  const review = await chooseMember(s,true);
  await s.controller.unlink(interaction('button',''),{ discordId:target,eosId:'b'.repeat(32) });
  await manual(s,'Correct Survivor','c'.repeat(32));
  const stale = await s.router.handle(interaction('button',component(review,'Confirm Unlink').custom_id));
  assert.equal(stale.content,'This link has changed. Start Unlink Player again.');
  assert.equal(s.runtime.players.byDiscord(target).eosId,'c'.repeat(32));
});

test('linking and unlinking recheck staff authority and actor/guild/channel/message binding, expiry and replay', async t => {
  const s = await setup(t);
  await manual(s);
  const review = await chooseMember(s,true);
  const button = component(review,'Confirm Unlink').custom_id;
  const mismatches = [{ user:{ id:id(9) } },{ guildId:id(9) },{ channelId:id(9) },
    { message:{ id:id(9) } },{ member:{ roleIds:[] } }];
  for (const extra of mismatches) {
    const denied = await s.router.handle(interaction('button',button,[],extra));
    assert.equal(denied.flags,64);
    assert(s.runtime.players.byDiscord(target));
  }
  const players = await chooseMember(s,false,id(8));
  const modal = await s.router.handle(interaction('button',component(players,'Enter Player Manually').custom_id));
  for (const extra of mismatches) {
    const denied = await s.router.handle(interaction('modal',modal.custom_id,[],{
      fields:{ getTextInputValue:key => key === 'player-name' ? 'Never Linked' : 'd'.repeat(32) },...extra }));
    assert.equal(denied.flags,64);
    assert.equal(s.runtime.players.byDiscord(id(8)),null);
  }
  t.mock.method(Date,'now',() => 9999999999999);
  assert.equal((await s.router.handle(interaction('button',button))).flags,64);
  assert(s.runtime.players.byDiscord(target));
});

test('concurrent link requests serialize uniqueness checks and database failures never mutate the registry', async t => {
  const s = await setup(t);
  const i = interaction('modal','');
  const results = await Promise.allSettled([target,id(8)].map(discordId => s.controller.associateManual(i,{
    discordId,displayName:'Concurrent Survivor',eosId:eos
  })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code,'IDENTITY_ALREADY_LINKED');
  await s.database.executeSql("CREATE TRIGGER reject_unlink BEFORE DELETE ON trusted_players BEGIN SELECT RAISE(ABORT, 'test rejection'); END");
  await assert.rejects(s.controller.unlink(i,{ discordId:target,eosId:eos }),/test rejection/);
  assert(s.runtime.players.byDiscord(target));
  await s.database.executeSql("CREATE TRIGGER reject_link BEFORE INSERT ON trusted_players BEGIN SELECT RAISE(ABORT, 'test rejection'); END");
  await assert.rejects(s.controller.associateManual(i,{
    discordId:id(8),displayName:'Failing Survivor',eosId:'c'.repeat(32)
  }),/test rejection/);
  assert.equal(s.runtime.players.byDiscord(id(8)),null);
  assert.deepEqual(s.runtime.players.list(),await s.runtime.playerRepository.list());
});

test('unlink invalidates previously scanned fulfillment targets before execution, even if still online', async t => {
  const s = await setup(t);
  const i = interaction('select','');
  await s.controller.associateManual(i,{ discordId:target,displayName:'Survivor',eosId:eos });
  const result = await s.controller.scanPage(i,{ serverIds:['map-one'] });
  const input = { playerRef:result.players[0].playerRef,serverId:'map-one',eosId:eos };
  await s.controller.unlink(i,{ discordId:target,eosId:eos });
  await assert.rejects(s.controller.begin(i,{ ...input,creatureId:'rex' }),/not verified/);
  assert.equal((await s.runtime.onlinePlayers.revalidate(input)).online,false);
  assert.deepEqual(s.operations,['listOnlinePlayers']);
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
