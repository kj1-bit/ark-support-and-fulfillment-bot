'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMigrationRunner}=require('../../src/migrations/migration-runner');
const names=['v2-core','trusted-state','player-names','tickets','pins','operational-events','fulfillment-targets'];
const migrations=names.map((name,index)=>require(`../../src/migrations/${String(index+1).padStart(3,'0')}-${name}`));
function dbFor(applied=[],failVersion=null){const calls=[];return {calls,executeSql:async sql=>{calls.push(sql);if(failVersion&&sql===`M${failVersion}`)throw new Error('migration failure');},all:async()=>applied.map(version=>({version})),run:async(sql,args)=>{calls.push([sql,args]);return {changes:1};}};}
test('every supported schema level upgrades in order to version 7',async()=>{for(let current=0;current<=6;current++){const db=dbFor(Array.from({length:current},(_,i)=>i+1));const version=await createMigrationRunner({database:db,migrations,clock:()=>0}).run();assert.equal(version,7);const inserts=db.calls.filter(Array.isArray).map(call=>call[1][0]);assert.deepEqual(inserts,Array.from({length:7-current},(_,i)=>current+i+1));}});
test('re-running schema 7 is idempotent',async()=>{const db=dbFor([1,2,3,4,5,6,7]);assert.equal(await createMigrationRunner({database:db,migrations}).run(),7);assert.equal(db.calls.filter(call=>call==='BEGIN IMMEDIATE').length,0);});
test('unknown future schema fails before migration transaction',async()=>{const db=dbFor([8]);await assert.rejects(()=>createMigrationRunner({database:db,migrations}).run(),/Unsupported database schema version/);assert(!db.calls.includes('BEGIN IMMEDIATE'));});
test('migration failure rolls back and never commits',async()=>{const custom=[{version:1,name:'one',statements:['M1']},{version:2,name:'two',statements:['M2']}];const db=dbFor([],2);await assert.rejects(()=>createMigrationRunner({database:db,migrations:custom}).run(),/migration failure/);assert.equal(db.calls.at(-1),'ROLLBACK');});
