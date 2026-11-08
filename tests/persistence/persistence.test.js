'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const migration=require('../../src/migrations/001-v2-core');const {createMigrationRunner}=require('../../src/migrations/migration-runner');const {backupDatabase,checkIntegrity,restoreDatabase}=require('../../src/recovery/database-recovery');const {createSqliteFulfillmentRepository}=require('../../src/adapters/sqlite/fulfillment-repository');
function fakeDb({failStatement=false,unknownVersion=false}={}){const calls=[];const rows=unknownVersion?[{version:99}]:[];return {calls,executeSql:async sql=>{calls.push(sql);if(failStatement&&sql.includes('fulfillment_requests'))throw new Error('boom');},all:async()=>rows,run:async(sql,args)=>{calls.push([sql,args]);return {changes:1};},get:async()=>({quick_check:'ok'})};}
test('migrations apply in transaction and record version',async()=>{const db=fakeDb();const version=await createMigrationRunner({database:db,migrations:[migration],clock:()=>0}).run();assert.equal(version,1);assert(db.calls.includes('BEGIN IMMEDIATE'));assert(db.calls.includes('COMMIT'));});
test('migration failure rolls back and unsupported schema fails closed',async()=>{const db=fakeDb({failStatement:true});await assert.rejects(()=>createMigrationRunner({database:db,migrations:[migration]}).run(),/boom/);assert(db.calls.includes('ROLLBACK'));await assert.rejects(()=>createMigrationRunner({database:fakeDb({unknownVersion:true}),migrations:[migration]}).run(),/Unsupported/);});
test('backup and restore verify checksum and preserve bytes',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ticketbot-v2-'));const databasePath=path.join(dir,'db.sqlite');fs.writeFileSync(databasePath,'known-good');const backup=backupDatabase({databasePath,backupDirectory:path.join(dir,'backups'),clock:()=>1});fs.writeFileSync(databasePath,'damaged');const restored=restoreDatabase({backupPath:backup.path,databasePath,expectedSha256:backup.sha256});assert.equal(fs.readFileSync(databasePath,'utf8'),'known-good');assert.equal(restored.sha256,backup.sha256);fs.rmSync(dir,{recursive:true,force:true});});
test('restore refuses checksum mismatch and integrity check fails closed',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ticketbot-v2-'));const backup=path.join(dir,'backup');fs.writeFileSync(backup,'x');assert.throws(()=>restoreDatabase({backupPath:backup,databasePath:path.join(dir,'db'),expectedSha256:'bad'}),/checksum/);await assert.rejects(()=>checkIntegrity({get:async()=>({quick_check:'corrupt'})}),/integrity/);fs.rmSync(dir,{recursive:true,force:true});});
test('migration runner rejects an incomplete database interface',()=>{
  assert.throws(
    ()=>createMigrationRunner({
      database:{
        executeSql:async()=>{},
        all:async()=>[]
      },
      migrations:[migration]
    }),
    /executeSql\/all\/run interface/
  );
});

test('fulfillment update fails when the stored state changes concurrently',async()=>{
  const row={
    id:'FUL-00000000-0000-4000-8000-000000000001',
    idempotency_key:'concurrency-test',
    actor_id:'10000000000000004',
    guild_id:'10000000000000001',
    channel_id:'10000000000000003',
    message_id:'10000000000000005',
    creature_id:'rex',
    catalog_version:'2026.1.0',
    server_id:'map-one',
    eos_id:'0123456789abcdef0123456789abcdef',
    state:'EXECUTING',
    created_at:1,
    expires_at:1000,
    claimed_at:2,
    completed_at:null,
    result_json:null
  };

  const repository=createSqliteFulfillmentRepository({
    get:async()=>row,
    run:async()=>({changes:0})
  });

  await assert.rejects(
    ()=>repository.update(
      row.id,
      'SUCCEEDED',
      {
        completedAt:50,
        results:[{success:true}]
      }
    ),
    /changed before the update completed/
  );
});

test('fulfillment result persistence stores only bounded, non-sensitive operation summaries',async()=>{
  const row={
    id:'FUL-00000000-0000-4000-8000-000000000001',
    state:'EXECUTING',
    result_json:null
  };
  let serialized;
  const repository=createSqliteFulfillmentRepository({
    get:async()=>row,
    run:async(_sql,args)=>(serialized=args[0],{changes:1})
  });

  await repository.updateResults(row.id,[{
    success:true,
    operationIndex:1,
    command:'admin password',
    response:'sensitive server output',
    eosId:'full-identifier'
  }]);
  assert.deepEqual(JSON.parse(serialized),[{success:true,operationIndex:1}]);
  assert(!serialized.includes('password'));
  assert(!serialized.includes('sensitive'));
  assert(!serialized.includes('full-identifier'));
  await assert.rejects(()=>repository.updateResults(row.id,Array.from({length:21},()=>({success:true}))),/at most 20/);
});

test('migration redacts existing raw fulfillment results while preserving safe summaries',async()=>{
  const migration=require('../../src/migrations/010-fulfillment-result-redaction');
  const rows=[
    {id:'FUL-1',resultJson:JSON.stringify([{success:true,operationIndex:2,command:'secret command',response:'raw output',eosId:'sensitive'}])},
    {id:'FUL-2',resultJson:'not-json'}
  ];
  const updates=[];
  const database={
    all:async(_sql,args)=>rows.filter(row=>row.id>args[0]),
    run:async(_sql,args)=>{updates.push(args);return {changes:1};}
  };
  await migration.up(database);
  assert.deepEqual(updates,[
    ['[{"success":true,"operationIndex":2}]','FUL-1'],
    [null,'FUL-2']
  ]);
});

test('restore replaces an existing database and removes temporary files',()=>{
  const dir=fs.mkdtempSync(
    path.join(os.tmpdir(),'ticketbot-v2-replace-')
  );
  const databasePath=path.join(dir,'database.sqlite');
  const backupPath=path.join(dir,'backup.sqlite');

  fs.writeFileSync(databasePath,'old-database');
  fs.writeFileSync(backupPath,'restored-database');

  const crypto=require('node:crypto');
  const expectedSha256=crypto
    .createHash('sha256')
    .update(fs.readFileSync(backupPath))
    .digest('hex');

  restoreDatabase({
    backupPath,
    databasePath,
    expectedSha256
  });

  assert.equal(
    fs.readFileSync(databasePath,'utf8'),
    'restored-database'
  );

  const leftovers=fs
    .readdirSync(dir)
    .filter(name=>
      name.includes('.restore-') ||
      name.includes('.previous-')
    );

  assert.deepEqual(leftovers,[]);

  fs.rmSync(dir,{recursive:true,force:true});
});