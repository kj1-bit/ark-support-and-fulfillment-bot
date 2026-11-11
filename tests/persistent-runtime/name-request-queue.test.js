'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabaseInterface, openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqlitePlayerNameRepository } = require('../../src/adapters/sqlite/player-name-repository');
const { createSqlitePlayerRepository } = require('../../src/adapters/sqlite/player-repository');
const { createRememberedPlayerRepository } = require('../../src/adapters/sqlite/remembered-player-repository');
const { createPlayerNameService } = require('../../src/domain/player-names/player-name-service');
const { createPlayerLinkService } = require('../../src/application/player-link-service');
const { createPlayerRegistry } = require('../../src/registries/player-registry');
const { createOnlinePlayerSelectionService } = require('../../src/application/online-player-selection-service');
const { createSqliteVaultPinRepository } = require('../../src/adapters/sqlite/vault-pin-repository');
const { createPinDirectoryService } = require('../../src/domain/pins/pin-directory-service');
const { createPinProtector } = require('../../src/security/pin-protector');
const { pinPagePayload } = require('../../src/features/dashboards-feature');

const id = n => `1000000000000${String(n).padStart(4,'0')}`;
const eos = n => n.toString(16).padStart(32,'0');
const migrations = fs.readdirSync(path.join(__dirname,'../../src/migrations'))
  .filter(name => /^\d{3}-/.test(name)).sort().map(name => require(`../../src/migrations/${name}`));

async function setup(t, version = 16) {
  const db = await openSqliteDatabase(':memory:');
  t.after(() => db.close());
  await createMigrationRunner({ database:db,migrations:migrations.filter(m => m.version <= version) }).run();
  const names = createSqlitePlayerNameRepository(db);
  const players = createPlayerRegistry([]);
  const events = [];
  const audit = { write:(type,data) => events.push({ type,data }) };
  const links = createPlayerLinkService({ repository:createSqlitePlayerRepository(db),players,audit,clock:() => 100 });
  const service = createPlayerNameService({ repository:names,audit,clock:() => 50 });
  return { db,names,players,events,links,service };
}
test('queue pages oldest unlinked pending and legacy verified requests and excludes linked users', async t => {
  const s = await setup(t);
  for (let n = 1; n <= 12; n++) {
    await s.db.run('INSERT INTO player_names (discord_id,player_name,status,updated_at) VALUES (?,?,?,?)',
      [id(n),`Player ${n}`,n === 2 ? 'VERIFIED' : 'PENDING',n]);
  }
  await s.db.run('INSERT INTO trusted_players VALUES (?,?,?,?,?)',[id(1),eos(1),'Player 1',1,'test']);
  const first = await s.names.queue(1);
  const second = await s.names.queue(2);
  assert.equal(first.total,11);
  assert.equal(first.results.length,10);
  assert.equal(first.results[0].discordId,id(2));
  assert.equal(first.results[0].status,'VERIFIED');
  assert.equal(second.results[0].discordId,id(12));
});
test('approval is atomic, blocks submitted changes while linked, and unlink restores pending', async t => {
  const s = await setup(t);
  const request = await s.service.submit({ discordId:id(1),playerName:'Player One' });
  await s.db.executeSql(`CREATE TRIGGER reject_link BEFORE INSERT ON trusted_players BEGIN SELECT RAISE(ABORT,'rejected'); END`);
  const input = { discordId:id(1),eosId:eos(1),displayName:'Player One',source:'manual',actorId:id(2),request };
  await assert.rejects(() => s.links.link(input),/rejected/);
  assert.equal((await s.names.findByDiscord(id(1))).status,'PENDING');
  assert.equal(s.players.byDiscord(id(1)),null);
  assert.equal(s.events.filter(e => e.type === 'player-link.created').length,0);
  await s.db.executeSql('DROP TRIGGER reject_link');
  await s.links.link(input);
  assert.equal((await s.names.findByDiscord(id(1))).moderatorId,id(2));
  assert.equal((await s.names.findByDiscord(id(1))).status,'VERIFIED');
  await assert.rejects(() => s.service.submit({ discordId:id(1),playerName:'New Name' }),{ code:'NAME_ALREADY_LINKED' });
  assert.equal((await s.names.findByDiscord(id(1))).playerName,'Player One');
  await s.links.unlink({ discordId:id(1),eosId:eos(1),actorId:id(2) });
  const result = await s.names.findByDiscord(id(1));
  assert.equal(result.status,'PENDING');
  assert.equal(result.moderatorId,null);
  assert.equal(result.verifiedAt,null);
  assert.equal((await s.names.queue()).results[0].discordId,id(1));
});
test('candidate matching prioritizes exact names, escapes wildcard characters and caps results', async t => {
  const s = await setup(t);
  const remembered = createRememberedPlayerRepository(s.db);
  for (let n = 0; n < 30; n++) {
    await remembered.remember({ eosId:eos(n),displayName:n === 0 ? 'Joe_One' : `Joe_One ${n}`,serverId:'map',lastSeenAt:n });
  }
  await remembered.remember({ eosId:eos(40),displayName:'JoeXOne',serverId:'map',lastSeenAt:100 });
  await remembered.remember({ eosId:eos(41),displayName:'Joe%One',serverId:'map',lastSeenAt:101 });
  const matches = await remembered.matching('joe_one');
  assert.equal(matches.length,25);
  assert.equal(matches[0].displayName,'Joe_One');
  assert(!matches.some(player => player.displayName === 'JoeXOne'));
  assert.deepEqual((await remembered.matching('Joe%')).map(player => player.displayName),['Joe%One']);
  assert.deepEqual(await remembered.matching('Nobody'),[]);
});
test('schema 15 upgrade approves existing pending links without changing names or other rows', async t => {
  const s = await setup(t,15);
  await s.db.run('INSERT INTO trusted_players VALUES (?,?,?,?,?)',[id(1),eos(1),'Old',42,'manual']);
  await s.db.run('INSERT INTO trusted_players VALUES (?,?,?,?,?)',[id(2),eos(2),'Old',43,'manual']);
  await s.db.run('INSERT INTO player_names (discord_id,player_name,status,updated_at) VALUES (?,?,?,?)',
    [id(1),'Submitted','PENDING',5]);
  await s.db.run('INSERT INTO player_names (discord_id,player_name,status,updated_at) VALUES (?,?,?,?)',
    [id(3),'Unlinked','VERIFIED',6]);
  await createMigrationRunner({ database:s.db,migrations }).run();
  await createMigrationRunner({ database:s.db,migrations }).run();
  const result = await s.names.findByDiscord(id(1));
  assert.equal(result.status,'VERIFIED');
  assert.equal(result.playerName,'Submitted');
  assert.equal(result.verifiedAt,42);
  assert.equal(result.updatedAt,5);
  assert.equal((await s.db.get('SELECT display_name FROM trusted_players WHERE discord_id=?',[id(1)])).display_name,'Old');
  const missing = await s.names.findByDiscord(id(2));
  assert.equal(missing.playerName,'Old');
  assert.equal(missing.status,'VERIFIED');
  assert.equal(missing.moderatorId,null);
  assert.equal(missing.verifiedAt,43);
  assert.equal((await s.names.findByDiscord(id(3))).status,'VERIFIED');
  assert.equal((await s.names.queue()).results[0].discordId,id(3));
});

test('renamed linked EOS remains owned while another player submits and links its old name', async t => {
  const s = await setup(t);
  const remembered = createRememberedPlayerRepository(s.db);
  const first = await s.service.submit({ discordId:id(1),playerName:'Joe' });
  await s.links.link({ discordId:id(1),eosId:eos(1),displayName:'Joe',source:'manual',actorId:id(9),request:first });
  await remembered.remember({ eosId:eos(1),displayName:'New Name',serverId:'map',lastSeenAt:200 });
  const second = await s.service.submit({ discordId:id(2),playerName:'Joe' });
  await remembered.remember({ eosId:eos(2),displayName:'Joe',serverId:'map',lastSeenAt:201 });
  assert.equal((await remembered.matching('Joe'))[0].eosId,eos(2));
  assert.equal((await s.names.linkedName(id(1))).displayName,'New Name');
  await s.links.link({ discordId:id(2),eosId:eos(2),displayName:'Joe',source:'manual',actorId:id(9),request:second });
  assert.equal(s.players.byDiscord(id(1)).eosId,eos(1));
  assert.equal(s.players.byDiscord(id(2)).eosId,eos(2));
  assert.equal((await s.names.findByDiscord(id(1))).status,'VERIFIED');
  assert.equal((await s.names.findByDiscord(id(1))).playerName,'Joe');
  const vault = createSqliteVaultPinRepository(s.db);
  const protector = createPinProtector({ key:Buffer.alloc(32,9).toString('base64') });
  await vault.insertIfAbsent({ guildId:id(8),userId:id(1),protectedPin:await protector.protect('5820'),
    source:'SELF_SERVICE',createdAt:1,updatedAt:1 });
  const directory = createPinDirectoryService({ repository:vault,protector,authorization:{ authorize() {} },
    guildId:id(8),channelId:id(7),staffRoleId:id(9) });
  const dashboard = pinPagePayload({ key:'pins' },await directory.restoration.page());
  assert.match(dashboard.embeds[0].description,/New Name/);
  assert(!dashboard.embeds[0].description.includes('Joe'));
  const online = createOnlinePlayerSelectionService({ players:s.players,rememberedPlayers:remembered,
    ark:{ listOnlinePlayers:async () => [{ eosId:eos(1),displayName:'New Name' },{ eosId:eos(2),displayName:'Joe' }] },
    audit:{ write() {} },clock:() => 300 });
  const context = { actorId:id(9),guildId:id(8),channelId:id(7) };
  const result = await online.scanPage({ context,serverIds:['map'],ttlMs:1000 });
  assert.equal(result.players[0].displayName,'New Name');
  assert.equal(online.resolve(result.players[0].playerRef,context).eosId,eos(1));
  assert.equal((await online.revalidate({ playerRef:result.players[0].playerRef,serverId:'map',eosId:eos(1) })).online,true);
  assert.equal(online.resolve(result.players[1].playerRef,context).eosId,eos(2));
});

test('stale requests and simultaneous attempts cannot link an EOS twice or mutate the losing name', async t => {
  const s = await setup(t);
  const first = await s.service.submit({ discordId:id(1),playerName:'First Name' });
  const second = await s.service.submit({ discordId:id(2),playerName:'Second Name' });
  await s.service.submit({ discordId:id(1),playerName:'Changed Name' });
  await s.service.submit({ discordId:id(1),playerName:'First Name' });
  await assert.rejects(() => s.links.link({ discordId:id(1),eosId:eos(1),displayName:'First Name',
    source:'manual',actorId:id(9),request:first }),{ code:'REQUEST_CHANGED' });
  const updated = await s.names.findByDiscord(id(1));
  const attempts = await Promise.allSettled([updated,second].map(request => s.links.link({
    discordId:request.discordId,eosId:eos(1),displayName:'Shared',source:'manual',actorId:id(9),request
  })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length,1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code,'IDENTITY_ALREADY_LINKED');
  assert.equal((await s.names.findByDiscord(id(2))).status,'PENDING');
  assert.equal(s.players.byDiscord(id(2)),null);
});

test('database transactions exclude unrelated operations until commit', async t => {
  const s = await setup(t);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const transaction = s.db.transaction(async db => {
    await db.run('INSERT INTO player_names (discord_id,player_name,status,updated_at) VALUES (?,?,?,?)',
      [id(1),'First','PENDING',1]);
    entered();
    await gate;
  });
  await started;
  let finished = false;
  const read = s.db.get('SELECT COUNT(*) AS count FROM player_names').then(row => { finished = true; return row; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished,false);
  release();
  await transaction;
  assert.equal((await read).count,1);
});

test('rollback failure preserves the original transaction error and releases the queue', async () => {
  const original = new Error('transaction operation failed');
  const calls = [];
  const database = createDatabaseInterface({
    run(sql, callback) {
      calls.push(sql);
      callback(sql === 'ROLLBACK' ? new Error('no transaction is active') : null);
    },
    get(sql, parameters, callback) {
      calls.push(sql);
      callback(null,{ value:1 });
    }
  });
  const transaction = database.transaction(async () => { throw original; });
  const next = database.get('SELECT 1');
  await assert.rejects(transaction, error => error === original);
  assert.deepEqual(await next,{ value:1 });
  assert.deepEqual(calls,['BEGIN IMMEDIATE','ROLLBACK','SELECT 1']);
});
