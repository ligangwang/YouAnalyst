import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import type {Collection,Snapshot} from './sync';

export function snapshotFiles(bucket:Bucket) {
  return {
    load:async(collection:Collection):Promise<{snapshot?:Snapshot;generation:string}>=>{
      const file=bucket.file(`entity-snapshots/${collection}.json`);
      let generation:string;
      try{const [metadata]=await file.getMetadata();generation=String(metadata.generation);}
      catch(error){if((error as {code?:number}).code===404)return {generation:'0'};throw error;}
      // Download the exact generation whose precondition will be used on save.
      const [content]=await bucket.file(file.name,{generation}).download();
      const snapshot=decode(JSON.parse(content.toString('utf8'))) as Snapshot;
      if(snapshot.version!==1||snapshot.collection!==collection||!(snapshot.watermark instanceof Timestamp)||!Array.isArray(snapshot.rows))throw Error('Invalid entity snapshot');
      if(new Set(snapshot.rows.map(row=>row.id)).size!==snapshot.rows.length)throw Error('Duplicate snapshot IDs');
      return {snapshot,generation};
    },
    save:async(collection:Collection,snapshot:Snapshot,generation:string)=>{
      await bucket.file(`entity-snapshots/${collection}.json`).save(JSON.stringify(encode(snapshot)),{
        resumable:false,contentType:'application/json',
        metadata:{cacheControl:'private, no-cache'},
        preconditionOpts:{ifGenerationMatch:generation},
      });
    },
  };
}
