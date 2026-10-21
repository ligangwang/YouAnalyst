import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import type {Collection,Snapshot} from './sync';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// One encoded row per line inside a valid JSON object. Stream both directions:
// full-directory serialization must not allocate an encoded copy of every row,
// a giant JSON string, and a download/upload buffer simultaneously.
async function* lines(snapshot:Snapshot){
  yield JSON.stringify({version:snapshot.version,collection:snapshot.collection,watermark:encode(snapshot.watermark)}).slice(0,-1)+',"rows":[\n';
  for(let i=0;i<snapshot.rows.length;i++)yield JSON.stringify(encode(snapshot.rows[i]))+(i<snapshot.rows.length-1?',\n':'\n');
  yield ']}\n';
}

export function snapshotFiles(bucket:Bucket) {
  return {
    load:async(collection:Collection):Promise<{snapshot?:Snapshot;generation:string}>=>{
      const file=bucket.file(`entity-snapshots/${collection}.json`);
      let generation:string;
      try{const [metadata]=await file.getMetadata();generation=String(metadata.generation);}
      catch(error){if((error as {code?:number}).code===404)return {generation:'0'};throw error;}
      // Download the exact generation whose precondition will be used on save.
      const input=bucket.file(file.name,{generation}).createReadStream();
      const reader=createInterface({input,crlfDelay:Infinity});
      const rows:Snapshot['rows']=[];
      let snapshot:Snapshot|undefined,closed=false;
      try{
        for await(const line of reader){
          if(!snapshot){
            if(!line.endsWith(',"rows":['))throw Error('Invalid entity snapshot header');
            const header=JSON.parse(line.slice(0,-9)+'}');
            snapshot={...header,watermark:decode(header.watermark),rows};
          }else if(line===']}'){closed=true;}
          else if(closed){if(line.trim())throw Error('Invalid entity snapshot trailer');}
          else rows.push(decode(JSON.parse(line.endsWith(',')?line.slice(0,-1):line)) as Snapshot['rows'][number]);
        }
      }finally{reader.close();input.destroy();}
      if(!snapshot||!closed)throw Error('Incomplete entity snapshot');
      if(snapshot.version!==1||snapshot.collection!==collection||!(snapshot.watermark instanceof Timestamp)||!Array.isArray(snapshot.rows))throw Error('Invalid entity snapshot');
      if(new Set(snapshot.rows.map(row=>row.id)).size!==snapshot.rows.length)throw Error('Duplicate snapshot IDs');
      return {snapshot,generation};
    },
    save:async(collection:Collection,snapshot:Snapshot,generation:string)=>{
      const output=bucket.file(`entity-snapshots/${collection}.json`).createWriteStream({
        resumable:false,contentType:'application/json',
        metadata:{cacheControl:'private, no-cache'},
        preconditionOpts:{ifGenerationMatch:generation},
      });
      await pipeline(Readable.from(lines(snapshot)),output);
    },
  };
}
