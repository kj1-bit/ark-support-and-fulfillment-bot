'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteTicketRepository } = require('../../src/adapters/sqlite/ticket-repository');
const { createSqlitePanelRepository } = require('../../src/adapters/sqlite/panel-repository');
const { createSqliteRetentionRepository } = require('../../src/adapters/sqlite/retention-repository');

const names = ['v2-core','trusted-state','player-names','tickets','pins','operational-events',
  'fulfillment-targets','trusted-identity-associations','discord-panels','fulfillment-result-redaction',
  'schema-integrity','ticket-channels','vault-pins','mock-ticket-multiplicity'];
const migrations = names.map((name,index) => require(`../../src/migrations/${String(index + 1).padStart(3,'0')}-${name}`));

test('removing legacy management leaves migrated historical records, Open Tickets visibility and closed retention intact', async t => {
  const database = await openSqliteDatabase(':memory:');
  t.after(() => database.close());
  await createMigrationRunner({ database,migrations:migrations.slice(0,11) }).run();
  for (const [id,state,updatedAt] of [['old-open','OPEN',100],['old-claimed','CLAIMED',100],
    ['old-closed','CLOSED',100],['recent-closed','CLOSED',5000]]) {
    await database.run(
      `INSERT INTO tickets (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id,'SUPPORT','Original preserved request',id,'Survivor','guild','requests',state,50,updatedAt]);
  }
  const before = await database.all('SELECT * FROM tickets ORDER BY id');
  assert.equal(await createMigrationRunner({ database,migrations }).run(),14);
  const upgraded = await database.all('SELECT * FROM tickets ORDER BY id');
  for (let index = 0; index < before.length; index += 1) {
    for (const [key,value] of Object.entries(before[index])) assert.equal(upgraded[index][key],value);
    for (const key of ['channel_status','completed_at','message_id']) assert.equal(upgraded[index][key],null);
  }
  const panels = createSqlitePanelRepository(database);
  await panels.save({ panelKey:'legacy-tickets',channelId:'logs',messageId:'old-panel',updatedAt:1 });
  await panels.remove({ panelKey:'legacy-tickets',channelId:'logs',messageId:'old-panel' });
  assert.deepEqual(await database.all('SELECT * FROM tickets ORDER BY id'),upgraded);
  const repository = createSqliteTicketRepository(database);
  const page = await repository.openPage('guild');
  assert.equal(page.total,2);
  assert.deepEqual(new Set(page.results.map(row => row.state)),new Set(['OPEN','CLAIMED']));
  assert(page.results.every(row => row.channelStatus === null));
  assert.equal(await repository.findActive('guild','old-open'),null,'historical rows must not block new private requests');
  const retention = createSqliteRetentionRepository(database);
  assert.equal(await retention.purgeClosedTickets(1000),1);
  assert.equal(await repository.get('old-closed'),null);
  for (const id of ['old-open','old-claimed','recent-closed']) assert(await repository.get(id));
});

test('retired panel binding removal is guarded against replacements and cannot delete another panel', async t => {
  const database = await openSqliteDatabase(':memory:');
  t.after(() => database.close());
  await createMigrationRunner({ database,migrations }).run();
  const panels = createSqlitePanelRepository(database);
  const original = { panelKey:'legacy-tickets',channelId:'logs',messageId:'old-panel',updatedAt:1 };
  await panels.save(original);
  await panels.save({ ...original,messageId:'replacement' });
  await panels.save({ ...original,panelKey:'open-tickets' });
  await panels.remove(original);
  assert.equal((await panels.get('legacy-tickets')).messageId,'replacement');
  await panels.remove({ ...original,messageId:'replacement' });
  assert.equal(await panels.get('legacy-tickets'),undefined);
  assert.equal((await panels.get('open-tickets')).messageId,'old-panel');
});
