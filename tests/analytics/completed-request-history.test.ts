import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Timestamp} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {CompletedRequestFiles} from '../../src/lib/instrument-onboarding/completed-history';

test('private completed request partitions preserve fields, ID lookup and exclusive admin cursors',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'request-history-test-'));
  const path=(key:string)=>join(dir,key.split('/').at(-1)!);
  const bucket={upload:(local:string,o:{destination:string})=>copyFile(local,path(o.destination)),
    file:(key:string)=>({download:(o:{destination:string})=>copyFile(path(key),o.destination)})} as unknown as Bucket;
  const files=new CompletedRequestFiles(bucket);
  try{
    const entries=[1,2,3].map(n=>{
      const id='INS_'+n.toString().padStart(32,'0');
      return {id,data:{instrumentId:id,status:'SUPPORTED',leaseOwner:null,leaseExpiresAt:0,lastError:null,
        updatedAt:Timestamp.fromMillis(123456),steps:{verify:'COMPLETE'},requestedByUid:'test-requester'}};
    });
    const file=await files.write('0',entries);
    assert.deepEqual(await files.read(file,{id:entries[0].id}),[entries[0]]);
    assert.deepEqual(await files.read(file,{after:entries[0].id,limit:1}),[entries[1]]);
    assert.deepEqual(await files.read(file),entries);
    await assert.rejects(files.write('0',[{...entries[0],data:{...entries[0].data,status:'BLOCKED'}}]),/completed, unlocked/);
  }finally{await files.close();await rm(dir,{recursive:true,force:true});}
});
