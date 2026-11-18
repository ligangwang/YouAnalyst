import {mkdtemp,appendFile,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DuckDBInstance} from '@duckdb/node-api';
import type {File} from '@google-cloud/storage';
import type {Firestore} from 'firebase-admin/firestore';
import {directoryGeneration,DIRECTORY_INDEX_ROOT} from './directory-index';
import {type MarketFiles,type MarketHead} from './files';
import {headId} from './repository';
import {splitRecord} from './policy';
import {RETAINED_CONTROL,retainedMode,retainedPath} from './retained-store';
import {quote} from '../price-store/parquet';

const fields=['symbolLower','searchPrefixes'];
async function saveOnce(file:File,data:Buffer|string){
    try{await file.save(data,{resumable:false,preconditionOpts:{ifGenerationMatch:0}});}
    catch(error){if(Number((error as {code?:number}).code)!==412)throw error;}
}

// Read the retained fields at the same snapshot as the shard revision.
// External Parquet objects are immutable and can be read outside the transaction.
async function shardTerms(raw:Firestore, files:MarketFiles, head:MarketHead){
    const file=files.bucket.file(`${DIRECTORY_INDEX_ROOT}/sources/${head.shard}/ready-${head.revision}.gz`);
    try{return gunzipSync((await file.download())[0]);}
    catch(error){if(Number((error as {code?:number}).code)!==404)throw error;}
    const retained=await raw.runTransaction(async tx=>{
        const [control,relocation]=await tx.getAll(raw.collection('collectors').doc(headId('companies',head.shard)),raw.doc(RETAINED_CONTROL));
        if(!retainedMode(relocation).ready || control.get('marketHead.revision')!==head.revision)return;
        const records=new Map<string,FirebaseFirestore.DocumentData>();
        const refs=head.retained.flatMap(id=>(['market_state','market_ugc'] as const).map(root=>raw.doc(retainedPath(root,'companies',id))));
        for(let i=0;i<refs.length;i+=100){
            const docs=await tx.getAll(...refs.slice(i,i+100),{fieldMask:fields});
            for(const doc of docs)if(doc.exists){
                if(records.has(doc.id))throw Error('Duplicate retained company');
                records.set(doc.id,doc.data()!);
            }
        }
        if(records.size!==head.retained.length)throw Error('Incomplete retained company shard');
        return records;
    },{readOnly:true});
    if(!retained)return;
    const rows=new Map((await files.query([head],[{method:'select',args:fields}])).map(row=>[row.id,row.data]));
    for(const [id,data] of retained){
        const external=rows.get(id);
        rows.set(id,external?{...external,...splitRecord('companies',id,data,true).retained}:data);
    }
    const lines=Array.from(rows,([id,data])=>JSON.stringify({id,symbolLower:data.symbolLower??null,searchPrefixes:data.searchPrefixes??[]}));
    const source=Buffer.from(lines.length?lines.join('\n')+'\n':'');
    await saveOnce(file,gzipSync(source));
    return source;
}

// Partition before grouping so millions of distinct substrings fit in the existing job.
export async function buildDirectoryParts(source:string,directory:string){
    const instance=await DuckDBInstance.create(':memory:',{threads:'1',memory_limit:'768MB'});
    const db=await instance.connect();
    const stage=join(directory,'terms'),output=join(directory,'parts');
    await mkdir(output,{recursive:true});
    try{
        await db.run('SET preserve_insertion_order=false');
        await db.run(`CREATE TABLE stocks AS SELECT * FROM read_ndjson(${quote(source)},columns={id:'VARCHAR',symbolLower:'VARCHAR',searchPrefixes:'VARCHAR[]'})`);
        await db.run(`COPY (WITH terms AS (
            SELECT 'n:'||unnest(list_distinct(searchPrefixes)) AS field,id,'' AS ordering FROM stocks
            UNION ALL SELECT 'e:'||symbolLower,id,'' FROM stocks WHERE symbolLower IS NOT NULL
            UNION ALL SELECT 's:'||left(symbolLower,i),id,symbolLower FROM stocks,
              UNNEST(generate_series(1,least(120,length(symbolLower)))) t(i)
              WHERE symbolLower<=left(symbolLower,i)||chr(63743)
        ) SELECT *,left(md5(substr(field,3)),2) AS part FROM terms) TO ${quote(stage)} (FORMAT PARQUET,PARTITION_BY(part))`);
        const parts=new Set(await readdir(stage));
        for(let n=0;n<256;n++){
            const part=n.toString(16).padStart(2,'0');
            const sql=parts.has('part='+part)
                ? `SELECT field,to_json(arg_min(id,struct_pack(symbol:=ordering,stock:=id),50))::VARCHAR AS payload
                   FROM read_parquet(${quote(join(stage,'part='+part,'*.parquet'))}) GROUP BY field ORDER BY field`
                : "SELECT ''::VARCHAR AS field,''::VARCHAR AS payload WHERE false";
            await db.run(`COPY (${sql}) TO ${quote(join(output,part+'.parquet'))} (FORMAT PARQUET,COMPRESSION ZSTD)`);
        }
        return output;
    }finally{db.closeSync();instance.closeSync();}
}

// These objects are derived caches. Keep the active generation and its inputs,
 // plus a week for rolling releases, before removing older immutable copies.
async function pruneDirectoryIndex(files:MarketFiles, heads:MarketHead[], generation:string){
    const sources=new Set(heads.map(h=>`${DIRECTORY_INDEX_ROOT}/sources/${h.shard}/ready-${h.revision}.gz`));
    const active=`${DIRECTORY_INDEX_ROOT}/${generation}/`;
    const cutoff=Date.now()-7*24*60*60*1000;
    for await(const file of files.bucket.getFilesStream({prefix:DIRECTORY_INDEX_ROOT+'/'})){
        const stored=file as File;
        if(stored.name.startsWith(active)||sources.has(stored.name))continue;
        const created=Date.parse(String(stored.metadata.timeCreated));
        if(created<cutoff && stored.metadata.generation)await stored.delete({ignoreNotFound:true,ifGenerationMatch:stored.metadata.generation});
    }
}

export async function publishDirectoryIndex(raw:Firestore,files:MarketFiles,heads:MarketHead[]){
    // The source includes both relocated roots only after their verified cutover.
    if(!retainedMode(await raw.doc(RETAINED_CONTROL).get()).ready)return;
    const generation=directoryGeneration(heads);
    if(!generation)throw Error('Incomplete company index inventory');
    const prefix=`${DIRECTORY_INDEX_ROOT}/${generation}`;
    const ready=files.bucket.file(prefix+'/complete');
    if((await ready.exists())[0]){await pruneDirectoryIndex(files,heads,generation);return;}
    const directory=await mkdtemp(join(tmpdir(),'company-search-'));
    try{
        const source=join(directory,'source.ndjson');
        for(const head of heads){
            const terms=await shardTerms(raw,files,head);
            if(!terms){console.info('Directory changed during index refresh; using live search');return;}
            await appendFile(source,terms);
        }
        const parts=await buildDirectoryParts(source,directory);
        for(const name of await readdir(parts))await saveOnce(files.bucket.file(prefix+'/'+name),await readFile(join(parts,name)));
        await saveOnce(ready,generation);
        await pruneDirectoryIndex(files,heads,generation);
        console.info(JSON.stringify({event:'directory_index_published',generation}));
    }finally{await rm(directory,{recursive:true,force:true});}
}
