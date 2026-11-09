'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openSqliteDatabase } = require('../../src/adapters/sqlite/open-database');
const { createMigrationRunner } = require('../../src/migrations/migration-runner');
const { createSqliteRetentionRepository } = require('../../src/adapters/sqlite/retention-repository');
const names = ['v2-core','trusted-state','player-names','tickets','pins','operational-events',
  'fulfillment-targets','trusted-identity-associations','discord-panels','fulfillment-result-redaction',
  'schema-integrity','ticket-channels','vault-pins'];
const migrations = names.map((name,index) => require(`../../src/migrations/${String(index+1).padStart(3,'0')}-${name}`));

test('additive schema 11 to 13 upgrade preserves existing V2 tickets, requests, and saved panels', async t => {
  const database = await openSqliteDatabase(':memory:');
  t.after(() => database.close());
  assert.equal(await createMigrationRunner({ database,migrations:migrations.slice(0,11) }).run(),11);
  for (const [id,type,state] of [['old-support','SUPPORT','OPEN'],['old-shop','SHOP','CLAIMED'],['old-closed','PIN','CLOSED']]) {
    await database.run(
      'INSERT INTO tickets (id,type,description,actor_id,player_name,guild_id,channel_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id,type,'Old request','requester','Survivor','guild','requests',state,1,2]
    );
  }
  await database.run(
    'INSERT INTO pin_requests (id,actor_id,player_name,guild_id,channel_id,protected_pin,state,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ['old-request','requester','Survivor','guild','vault','test-sealed-material','PENDING',1,2,999]
  );
  await database.run(
    'INSERT INTO discord_panel_messages (panel_key,channel_id,message_id,updated_at) VALUES (?,?,?,?)',
    ['tickets','logs','saved-message',2]
  );
  const tickets = await database.all('SELECT * FROM tickets ORDER BY id');
  const pins = await database.all('SELECT * FROM pin_requests');
  const panels = await database.all('SELECT * FROM discord_panel_messages');
  assert.equal(await createMigrationRunner({ database,migrations }).run(),13);
  const upgraded = await database.all('SELECT * FROM tickets ORDER BY id');
  assert.equal(upgraded.length,tickets.length);
  for (let i=0;i<tickets.length;i++) {
    for (const [key,value] of Object.entries(tickets[i])) assert.equal(upgraded[i][key],value);
    assert.equal(upgraded[i].channel_status,null);
    assert.equal(upgraded[i].ticket_number,null);
    assert.equal(upgraded[i].completed_at,null);
  }
  assert.deepEqual(await database.all('SELECT * FROM pin_requests'),pins);
  assert.deepEqual(await database.all('SELECT * FROM discord_panel_messages'),panels);
  assert.equal(await createMigrationRunner({ database,migrations }).run(),13);
  assert.deepEqual(await database.all('SELECT * FROM tickets ORDER BY id'),upgraded);
});

test('terminal PIN retention removes dependent moderation links without purging active or recent requests', async t => {
  const database = await openSqliteDatabase(':memory:');
  t.after(() => database.close());
  await createMigrationRunner({ database,migrations }).run();
  assert.equal((await database.get('PRAGMA foreign_keys')).foreign_keys,1);
  const records = [
    ['old-delivered','DELIVERED',1],['old-canceled','CANCELED',1],['old-expired','EXPIRED',1],
    ['active-pending','PENDING',1],['active-approved','APPROVED',1],['recent-delivered','DELIVERED',100]
  ];
  for (const [id,state,updatedAt] of records) {
    await database.run(
      'INSERT INTO pin_requests (id,actor_id,player_name,guild_id,channel_id,protected_pin,state,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id,id,'Survivor','guild','vault','test-sealed-material',state,1,updatedAt,999]
    );
    await database.run(
      'INSERT INTO pin_request_messages (request_id,channel_id,message_id,created_at) VALUES (?,?,?,?)',
      [id,'staff-pins',`message-${id}`,1]
    );
  }
  await database.run(
    'INSERT INTO vault_pins (guild_id,user_id,protected_pin,source,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    ['guild','survivor','test-generated-material','SELF_SERVICE',1,1]
  );
  const retention = createSqliteRetentionRepository(database);
  assert.equal(await retention.purgePinRequests(100),3);
  const remaining = ['active-approved','active-pending','recent-delivered'];
  assert.deepEqual((await database.all('SELECT id FROM pin_requests ORDER BY id')).map(row => row.id),remaining);
  assert.deepEqual(
    (await database.all('SELECT request_id FROM pin_request_messages ORDER BY request_id')).map(row => row.request_id),
    remaining
  );
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM vault_pins')).count,1);
  assert.equal(await retention.purgePinRequests(100),0);
});
