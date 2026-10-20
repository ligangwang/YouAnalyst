import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMigrationSafetyReader} from '../../scripts/firestore/migration-safety';

test('migration safety checks leave log quota headroom without skipping checks',async()=>{
 let time=0,calls=0;const sleeps:number[]=[];
 const read=createMigrationSafetyReader({now:()=>time,sleep:async ms=>{sleeps.push(ms);time+=ms;}});
 for(let i=0;i<4;i++)await read(async()=>{calls++;return new Response('{}');});
 assert.equal(calls,4);assert.deepEqual(sleeps,[2000,2000,2000]);
});
test('quota backoff waits for a successful safety read before allowing a batch',async()=>{
 let time=0,calls=0,writes=0;const sleeps:number[]=[];
 const read=createMigrationSafetyReader({now:()=>time,sleep:async ms=>{assert.equal(writes,0);sleeps.push(ms);time+=ms;}});
 const response=await read(async()=>new Response('{}',{status:++calls<3?429:200}));
 if(response.ok)writes++;
 assert.equal(writes,1);assert.equal(calls,3);assert.deepEqual(sleeps,[60000,60000]);
});
test('persistent quota errors remain failures and other errors are not hidden',async()=>{
 let time=0,calls=0;
 const read=createMigrationSafetyReader({now:()=>time,sleep:async ms=>{time+=ms;}});
 assert.equal((await read(async()=>{calls++;return new Response('{}',{status:429});})).status,429);
 assert.equal(calls,3);
 assert.equal((await read(async()=>new Response('{}',{status:403}))).status,403);
});
