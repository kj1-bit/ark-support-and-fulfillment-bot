'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteVaultPinRepository } = require('../../src/adapters/sqlite/vault-pin-repository');
const { createSqlitePinRepository } = require('../../src/adapters/sqlite/pin-repository');
const { createPinDirectoryService } = require('../../src/domain/pins/pin-directory-service');
const { createPinProtector } = require('../../src/security/pin-protector');
const { authorize, createAuthorizationPolicy } = require('../../src/security/authorization');
const { createOperationalEventService } = require('../../src/domain/dashboards/operational-event-service');

const GUILD = '10000000000000001';
const CHANNEL = '10000000000000002';
const STAFF = '10000000000000003';
const ACTOR = '10000000000000004';
const userId = index => `20000000000000${String(index).padStart(3,'0')}`;
const context = { guildId:GUILD, channelId:CHANNEL, actorId:ACTOR, roleIds:[STAFF] };
const policy = createAuthorizationPolicy({
  guildId:GUILD, capabilities:{ 'pins.moderate':{ roleIds:[STAFF], channelIds:[CHANNEL] } }
});
const authorization = { authorize:(capability,input) => authorize(policy,capability,input) };
const migrations = [
  require('../../src/migrations/001-v2-core'), require('../../src/migrations/002-trusted-state'),
  require('../../src/migrations/003-player-names'), require('../../src/migrations/004-tickets'),
  require('../../src/migrations/005-pins'), require('../../src/migrations/013-vault-pins')
];

test('staff directory pages real encrypted Vault rows and names, never historical custom requests, across restart', async t => {
  const folder = await mkdtemp(path.join(tmpdir(),'pin-directory-'));
  let database = await openSqliteDatabase(path.join(folder,'directory.sqlite'));
  t.after(async () => { await database.close(); await rm(folder,{ recursive:true }); });
  await createMigrationRunner({ database,migrations,clock:() => 0 }).run();
  const protector = createPinProtector({ key:Buffer.alloc(32,9).toString('base64') });
  const repository = createSqliteVaultPinRepository(database);
  for (let i = 0; i < 23; i += 1) {
    await database.run('INSERT INTO player_names (discord_id,player_name,status,updated_at) VALUES (?,?,?,?)',
      [userId(i),`Survivor ${i}`,'VERIFIED',0]);
    await repository.insertIfAbsent({
      guildId:GUILD,userId:userId(i),protectedPin:await protector.protect(String(5800+i)),source:'STAFF_BULK',createdAt:0,updatedAt:0
    });
  }
  await repository.insertIfAbsent({
    guildId:'30000000000000001',userId:ACTOR,protectedPin:await protector.protect('6782'),source:'SELF_SERVICE',createdAt:0,updatedAt:0
  });
  const custom = createSqlitePinRepository(database);
  await custom.create({
    id:'PIN-old', actorId:ACTOR, playerName:'Historical custom', guildId:GUILD, channelId:CHANNEL,
    protectedPin:await protector.protect('2468'), state:'PENDING', createdAt:0, updatedAt:0, expiresAt:10000
  });
  await custom.attachModerationMessage({ requestId:'PIN-old', channelId:CHANNEL, messageId:'old', createdAt:0 });
  let reveals = 0;
  const options = {
    repository, authorization, guildId:GUILD, channelId:CHANNEL, staffRoleId:STAFF,
    protector:{ reveal:async value => { reveals += 1; return protector.reveal(value); } }
  };
  const service = createPinDirectoryService(options);
  const first = await service.staff.page({ context });
  assert.equal(first.total,23);
  assert.equal(first.results.length,10);
  assert.equal(reveals,10);
  assert.deepEqual(first.results[0],{ userId:userId(0),playerName:'Survivor 0',pin:'5800' });
  assert(!JSON.stringify(first).includes('protectedPin'));
  const second = await service.staff.page({ context,page:2 });
  const third = await service.staff.page({ context,page:3 });
  assert.equal(reveals,23);
  assert.equal(new Set([...first.results,...second.results,...third.results].map(row => row.userId)).size,23);
  const clamped = await service.staff.page({ context,page:1000 });
  assert.equal(clamped.page,3);
  assert.equal(clamped.results.length,3);
  const stored = await repository.get(GUILD,userId(0));
  assert(stored.protectedPin.startsWith('v1.'));
  assert(!stored.protectedPin.includes('5800'));
  assert.equal((await custom.get('PIN-old')).state,'PENDING');
  assert.deepEqual(await custom.listRetiredControls({ guildId:GUILD,channelId:CHANNEL }),[
    { id:'PIN-old',messageId:'old',channelId:CHANNEL }
  ]);
  assert.deepEqual(await custom.listRetiredControls({ guildId:'wrong',channelId:CHANNEL }),[]);
  assert.deepEqual(await custom.listRetiredControls({ guildId:GUILD,channelId:'wrong' }),[]);
  const audit = [];
  await createOperationalEventService({ repository:{ append:async event => audit.push(event),query:async () => ({}) } })
    .record('pin.vault-generated',{ pin:first.results[0].pin,protectedPin:stored.protectedPin,userId:userId(0) });
  assert(!JSON.stringify(audit).includes('5800'));
  assert(!JSON.stringify(audit).includes(stored.protectedPin));

  await database.close();
  database = await openSqliteDatabase(path.join(folder,'directory.sqlite'));
  const restarted = createPinDirectoryService({
    ...options,repository:createSqliteVaultPinRepository(database)
  });
  assert.deepEqual(await restarted.restoration.page(2),second);
  assert.equal((await createSqlitePinRepository(database).get('PIN-old')).state,'PENDING');
});

test('user reader authorizes role, guild, channel and actor before any database read/decrypt; no bypass flag', async () => {
  let reads = 0;
  const service = createPinDirectoryService({
    repository:{ directoryPage:async () => { reads += 1; return { results:[] }; } },
    protector:{ reveal:() => assert.fail('Unexpected reveal') },authorization,
    guildId:GUILD,channelId:CHANNEL,staffRoleId:STAFF
  }).staff;
  for (const bad of [undefined,{}, { ...context,roleIds:[] },{ ...context,guildId:'wrong' },
    { ...context,channelId:'wrong' },{ ...context,actorId:'invalid' }]) {
    await assert.rejects(() => service.page({ context:bad, trusted:true, internal:true }));
  }
  assert.equal(reads,0);
  assert.equal(service.restoration,undefined);
  for (const page of [0,-1,1.1,1001,'1',NaN]) {
    await assert.rejects(() => service.page({ context,page }),/Invalid/);
  }
  assert.equal(reads,0);
});

test('repository and decryption failures are secret-free and never produce success-shaped directory pages', async () => {
  for (const repository of [
    { directoryPage:async () => { throw new Error('ciphertext private 5820'); } },
    { directoryPage:async () => ({ page:1,total:1,pageSize:10,results:[{ protectedPin:'ciphertext' }] }) }
  ]) {
    const service = createPinDirectoryService({
      repository, protector:{ reveal:async () => { throw new Error('ciphertext private 5820'); } },
      authorization,guildId:GUILD,channelId:CHANNEL,staffRoleId:STAFF
    });
    await assert.rejects(() => service.staff.page({ context }),error => {
      assert.equal(error.message,'The PIN directory could not be loaded. Contact staff.');
      assert(!JSON.stringify(error).includes('ciphertext'));
      return true;
    });
  }
});
