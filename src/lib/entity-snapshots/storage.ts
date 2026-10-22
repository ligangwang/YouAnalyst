import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {encode,decode} from '../central-cache/codec';
import type {Collection,Snapshot} from './sync';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {performance} from 'node:perf_hooks';

type LoadOptions={reason?:'cold'|'refresh';log?:(entry:Record<string,unknown>)=>void};

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
    load:async(collection:Collection,projectRow?:(row:Snapshot['rows'][number])=>Snapshot['rows'][number]|undefined,options:LoadOptions={}):Promise<{snapshot?:Snapshot;generation:string}>=>{
      const started=performance.now();
      let metadataMs=0,downloadStarted:number|undefined,downloadEnded:number|undefined,processingMs=0,bytesDownloaded=0,rowsDecoded=0;
      let status='error',errorCode:string|number|undefined;
      try{
      const file=bucket.file(`entity-snapshots/${collection}.json`);
      let generation:string;
      try{const [metadata]=await file.getMetadata();generation=String(metadata.generation);}
      catch(error){if((error as {code?:number}).code===404){status='missing';return {generation:'0'};}throw error;}
      finally{metadataMs=performance.now()-started;}
      // Download the exact generation whose precondition will be used on save.
      downloadStarted=performance.now();
      const input=bucket.file(file.name,{generation}).createReadStream();
      const reader=createInterface({input,crlfDelay:Infinity});
      input.on('data',(chunk:Buffer|string)=>{bytesDownloaded+=typeof chunk==='string'?Buffer.byteLength(chunk):chunk.length;});
      input.once('end',()=>{downloadEnded=performance.now();});
      const rows:Snapshot['rows']=[];
      const ids=new Set<string>();
      let snapshot:Snapshot|undefined,closed=false;
      try{
        for await(const line of reader){
          const processingStarted=performance.now();
          try{
          if(!snapshot){
            if(!line.endsWith(',"rows":['))throw Error('Invalid entity snapshot header');
            const header=JSON.parse(line.slice(0,-9)+'}');
            snapshot={...header,watermark:decode(header.watermark),rows};
          }else if(line===']}'){closed=true;}
          else if(closed){if(line.trim())throw Error('Invalid entity snapshot trailer');}
          else {
            const row=decode(JSON.parse(line.endsWith(',')?line.slice(0,-1):line)) as Snapshot['rows'][number];
            if(ids.has(row.id))throw Error('Duplicate snapshot IDs');
            ids.add(row.id);
            rowsDecoded++;
            const projected=projectRow?projectRow(row):row;
            if(projected)rows.push(projected);
          }
          }finally{processingMs+=performance.now()-processingStarted;}
        }
      }finally{reader.close();input.destroy();}
      const validationStarted=performance.now();
      try{
      if(!snapshot||!closed)throw Error('Incomplete entity snapshot');
      if(snapshot.version!==1||snapshot.collection!==collection||!(snapshot.watermark instanceof Timestamp)||!Array.isArray(snapshot.rows))throw Error('Invalid entity snapshot');
      if(new Set(snapshot.rows.map(row=>row.id)).size!==snapshot.rows.length)throw Error('Duplicate snapshot IDs');
      }finally{processingMs+=performance.now()-validationStarted;}
      status='success';
      return {snapshot,generation};
      }catch(error){errorCode=(error as {code?:string|number})?.code??'unknown';throw error;}
      finally{
        const ended=performance.now(),ms=(value:number)=>Math.round(value*100)/100;
        // Streaming overlaps download and processing. downloadMs includes stream
        // backpressure; processingMs measures synchronous decode/project/validation
        // work, not pure CPU time. These durations must not be added together.
        const entry={event:'entity_snapshot_file_read',severity:status==='error'?'WARNING':'INFO',
          collection,reason:options.reason??'file_load',status,errorCode,
          metadataMs:ms(metadataMs),downloadMs:ms(downloadStarted===undefined?0:(downloadEnded??ended)-downloadStarted),
          processingMs:ms(processingMs),totalMs:ms(ended-started),bytesDownloaded,rowsDecoded,
          timingsOverlap:true,downloadIncludesBackpressure:true,
          revision:process.env.K_REVISION,job:process.env.CLOUD_RUN_JOB,execution:process.env.CLOUD_RUN_EXECUTION};
        try{(options.log??(value=>console.info(JSON.stringify(value))))(entry);}catch{/* Logging must not fail a read. */}
      }
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
