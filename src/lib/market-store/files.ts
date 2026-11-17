import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bucket } from '@google-cloud/storage';
import { Timestamp } from 'firebase-admin/firestore';
import { encode, decode } from '../central-cache/codec';
import { withDuck, quote } from '../price-store/parquet';
import { PriceStore } from '../price-store/storage';
import { queryIndex, fieldName, type Data } from './value';
import { compileMarketQuery, project,filterIdentityOrdered, type Step } from './query';
import type { MarketCollection } from './policy';
import { encodeMarket, decodeMarket, hydrateMarket } from './blobs';
import { MARKET_INDEX_FIELDS, MARKET_INDEX_PAYLOAD_FIELDS, marketIndexField, marketIndexProjectionField,marketIndexBundled,marketIndexFormat } from './index-fields';
import {PrefixCache,buildPrefixLookup,encodePrefixLookup,decodePrefixLookup,type PrefixRows,type PrefixLookup} from './prefix-cache';
import {ANNOUNCEMENT_LOOKUP,announcementLookup,announcementPlan,announcementIds} from './announcement-index';
import {announcementBucket,announcementIndexFile,announcementIndexRows} from './announcement-sidecar';
export const MARKET_ROOT = 'market-parquet/v1';
export const shardFor = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 2);
export type MarketRow = {
    id: string;
    data: Data;
    version: Timestamp;
};
export type MarketHead = {
    collection: MarketCollection;
    shard: string;
    file?: string;
    bytes?: number;
    rows: number;
    retained: string[];
    revision?: string;
    format?: number;
    indexFile?: string;
    indexBytes?: number;
    prefixFile?: string;
    prefixBytes?: number;
};
const CALENDAR_LOOKUP='type/scheduled_date';
// Format 11 keeps the same field/payload schema in a small immutable sidecar.
export const calendarIndexFile=(prefixFile:string)=>prefixFile.replace(/\.parquet$/,'-ca.parquet');
const ANNOUNCEMENT_COMPANY=ANNOUNCEMENT_LOOKUP+'/company/';
const ANNOUNCEMENT_RECORDS=ANNOUNCEMENT_LOOKUP+'/records/';
const searchPayload = new Set(['searchPrefixes', 'searchTerms', 'namePrefixes', 'symbolPrefixes']);
const decodePayload = (payload: string): Data => { const wire = JSON.parse(payload); return Array.isArray(wire) ? decodeMarket(wire) : Object.fromEntries(Object.entries(wire).map(([key, value]) => [key, decodeMarket(value)])); };
export class MarketFiles {
    private cache: PriceStore;
    private prefixes=new PrefixCache();
    private announcementPrefixes:PrefixCache;
    private queryResults=new Map<string,{value:Promise<MarketRow[]>;bytes:number}>();
    private queryBudget:number;
    // The 6 GiB web service can retain the compact market working set. Smaller
    // workers keep their original limit; all caches remain bounded.
    private readonly web = ['ifindata-web', 'market-parquet-ui-probe'].includes(process.env.K_SERVICE ?? '');
    constructor(readonly bucket: Bucket, queryBudget?:number) {
        // Bundlers can lower class fields into constructor statements. Resolve
        // defaults here, after `web` is initialized, not in parameter bindings.
        queryBudget ??= this.web ? 32 * 1024 * 1024 : 0;
        if(!Number.isSafeInteger(queryBudget)||queryBudget<0||queryBudget>32*1024*1024)throw Error('Invalid market query cache budget');
        this.queryBudget=queryBudget;
        // Event IDs need ~84 MiB as UTF-8. Reserve a separate 96 MiB lookup
        // cache on the website so search prefixes cannot evict every timeline.
        // Borrow the same bytes from file caching; total cache budget is unchanged.
        this.announcementPrefixes=this.web?new PrefixCache(96*1024*1024):this.prefixes;
        this.cache = new PriceStore(bucket, (this.web ? 416 : 64) * 1024 * 1024-queryBudget);
    }
    close() { this.queryResults.clear();this.prefixes.clear();this.announcementPrefixes.clear();return this.cache.close(); }
    private async local<T>(names: string[], work: (paths: string[]) => Promise<T>): Promise<T> {
        const paths: string[] = [], holds: Promise<unknown>[] = [];
        let release!: () => void;
        const done = new Promise<void>(resolve => { release = resolve; });
        try {
            // Refill each download slot as it finishes. Fixed batches make every
            // later file wait for the slowest object in each preceding batch.
            let cursor=0,failedDownload=false;
            const outcomes=await Promise.allSettled(Array.from({length:Math.min(32,names.length)},async()=>{
                try{while(!failedDownload){
                    const index=cursor++;if(index>=names.length)return;
                    await new Promise<void>((resolve,reject)=>{
                        const hold=this.cache.local([names[index]],async([path])=>{paths[index]=path;resolve();await done;});
                        hold.catch(reject);holds.push(hold);
                    });
                }}catch(error){failedDownload=true;throw error;}
            }));
            const failed=outcomes.find(outcome=>outcome.status==='rejected');
            if(failed?.status==='rejected')throw failed.reason;
            return await work(paths);
        }
        finally {
            release();
            await Promise.allSettled(holds);
        }
    }
    private validate(file: string) { if (!/^market-parquet\/v1\/data\/[a-z_]+\/[a-f0-9]{2}\/[a-f0-9-]+\.parquet$/.test(file))
        throw Error('Invalid market Parquet pointer'); }
    async read(head: MarketHead): Promise<MarketRow[]> {
        if (!head.file)
            return [];
        this.validate(head.file);
        return this.cache.local([head.file], paths => withDuck(async (db) => (await db.runAndReadAll(`SELECT id,payload,version FROM read_parquet(${quote(paths[0])}) ORDER BY id`)).getRows().map(([id, payload, version]) => ({ id: String(id), data: decodePayload(String(payload)), version: decode(JSON.parse(String(version))) as Timestamp }))));
    }
    private prefixKey(head:MarketHead,field:string){return `${head.prefixFile}|${head.shard}|${field}`;}
    private async loadPrefixes(heads:MarketHead[],field:string,packIds=false){
        const names=[...new Set(heads.map(head=>head.prefixFile!))];
        for(const name of names)this.validate(name);
        const storedField=(head:MarketHead)=>marketIndexBundled(head.format)?`${field}:${head.shard}`:field;
        const wanted=new Map(heads.map(head=>[`${head.prefixFile}|${storedField(head)}`,this.prefixKey(head,field)]));
        return this.local(names,paths=>withDuck(async db=>{
            const originals=new Map(paths.map((path,i)=>[path.replaceAll('\\','/'),names[i]]));
            const fields=[...new Set(heads.map(storedField))];
            const rows=(await db.runAndReadAll(`SELECT filename,field,payload FROM read_parquet([${paths.map(quote).join(',')}],filename=true) WHERE field IN (${fields.map(quote).join(',')})`)).getRows();
            const found=new Map<string,PrefixLookup>();
            for(const [filename,stored,payload] of rows){
                const name=originals.get(String(filename).replaceAll('\\','/'));if(!name)throw Error('Unexpected prefix index file');
                const key=wanted.get(`${name}|${stored}`);if(!key)continue;
                if(found.has(key))throw Error('Duplicate prefix index');
                found.set(key,decodePrefixLookup(String(payload),packIds));
            }
            return found;
        }));
    }
    /** Return only this company's posting lists; decoding every event identity
     * on a cold company page competes with all other DuckDB work. Legacy
     * lookup rows also serve as completeness markers for each requested shard. */
    private async announcementMatches(heads:MarketHead[],company:string):Promise<string[]> {
        if(!heads.length)return [];
        const names=[...new Set(heads.map(head=>head.prefixFile!))];for(const name of names)this.validate(name);
        const stored=(head:MarketHead,field:string)=>marketIndexBundled(head.format)?field+':'+head.shard:field;
        const markers=new Set(heads.map(head=>head.prefixFile+'|'+stored(head,ANNOUNCEMENT_LOOKUP)));
        const postings=new Set(heads.map(head=>head.prefixFile+'|'+stored(head,ANNOUNCEMENT_COMPANY+company)));
        const fields=[...new Set(heads.flatMap(head=>[stored(head,ANNOUNCEMENT_LOOKUP),stored(head,ANNOUNCEMENT_COMPANY+company)]))];
        const selected=[...new Set(heads.map(head=>stored(head,ANNOUNCEMENT_COMPANY+company)))];
        const rows=await this.local(names,paths=>withDuck(async db=>{
            const original=new Map(paths.map((path,i)=>[path.replaceAll('\\','/'),names[i]]));
            return (await db.runAndReadAll(`SELECT filename,field,CASE WHEN field IN (${selected.map(quote).join(',')}) THEN payload ELSE NULL END FROM read_parquet([${paths.map(quote).join(',')}],filename=true) WHERE field IN (${fields.map(quote).join(',')})`)).getRows().map(([filename,field,payload])=>{
                const name=original.get(String(filename).replaceAll('\\','/'));if(!name)throw Error('Unexpected announcement index file');
                return {key:name+'|'+String(field),payload};
            });
        }));
        const seen=new Set<string>(),matches:string[]=[];
        for(const {key,payload} of rows){
            if(!markers.has(key)&&!postings.has(key))continue;
            if(seen.has(key))throw Error('Duplicate announcement posting');seen.add(key);
            if(markers.has(key))continue;
            const ids:unknown=JSON.parse(String(payload));
            if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Invalid announcement postings');
            matches.push(...ids);
        }
        if([...markers].some(key=>!seen.has(key)))throw Error('Incomplete announcement index');
        return matches;
    }
    /** Cover projected announcement cards without reopening broad shared indexes. */
    private async announcementRows(heads:MarketHead[],company:string):Promise<MarketRow[]> {
        if(!this.queryBudget)return this.announcementRowsUncached(heads,company);
        // Live writes replace only a few immutable shard lookups. Reuse each
        // unchanged company's rows within the existing shared result budget.
        const active=heads.filter(head=>head.file);
        const keys=active.map(head=>'d:announcement:'+createHash('sha256').update(JSON.stringify([
            head.collection,head.shard,head.prefixFile,head.format,company,
        ])).digest('hex'));
        const found=keys.map(key=>{const entry=this.queryResults.get(key);if(entry){this.queryResults.delete(key);this.queryResults.set(key,entry);}return entry;});
        const missing=active.filter((_,i)=>!found[i]);
        if(missing.length){
            const loaded=this.announcementRowsUncached(missing,company).then(rows=>{
                const shards=new Map<string,MarketRow[]>();for(const row of rows){const shard=shardFor(row.id),values=shards.get(shard)??[];values.push(row);shards.set(shard,values);}return shards;
            });
            active.forEach((head,i)=>{if(found[i])return;const entry={value:loaded.then(shards=>shards.get(head.shard)??[]),bytes:0};found[i]=entry;this.remember(keys[i],entry);});
        }
        return (await Promise.all(found.map(entry=>entry!.value))).flat();
    }
    private async announcementRowsUncached(heads:MarketHead[],company:string):Promise<MarketRow[]> {
        const active=heads.filter(head=>head.file),bucket=announcementBucket(company);
        const source=(head:MarketHead)=>marketIndexFormat(head.format)>=12?announcementIndexFile(head.prefixFile!,bucket):head.prefixFile!;
        const names=[...new Set(active.map(source))];
        for(const name of names)this.validate(name);
        const field=ANNOUNCEMENT_RECORDS+company;
        const stored=(head:MarketHead,key:string)=>marketIndexBundled(head.format)?key+':'+head.shard:key;
        const wanted=new Map(active.map(head=>[source(head)+'|'+stored(head,field),head.shard]));
        const markers=new Set(active.map(head=>source(head)+'|'+stored(head,ANNOUNCEMENT_LOOKUP)));
        const present=new Map(active.map(head=>[source(head)+'|'+stored(head,ANNOUNCEMENT_COMPANY+company),source(head)+'|'+stored(head,field)]));
        const selected=[...new Set(active.map(head=>stored(head,field)))];
        const fields=[...new Set(active.flatMap(head=>[stored(head,field),stored(head,ANNOUNCEMENT_LOOKUP),stored(head,ANNOUNCEMENT_COMPANY+company)]))];
        if(!active.length)return [];
        return this.local(names,paths=>withDuck(async db=>{
            const originals=new Map(paths.map((path,i)=>[path.replaceAll('\\','/'),names[i]]));
            const result:MarketRow[]=[],seen=new Set<string>(),ids=new Set<string>();
            const rows=(await db.runAndReadAll(`SELECT filename,field,CASE WHEN field IN (${selected.map(quote).join(',')}) THEN payload ELSE NULL END FROM read_parquet([${paths.map(quote).join(',')}],filename=true) WHERE field IN (${fields.map(quote).join(',')})`)).getRows();
            for(const [filename,key,payload] of rows){
                const identity=originals.get(String(filename).replaceAll('\\','/'))+'|'+key,shard=wanted.get(identity);
                if(!shard&&!markers.has(identity)&&!present.has(identity))continue;
                if(seen.has(identity))throw Error('Duplicate announcement projection');seen.add(identity);
                if(!shard)continue;
                const records:unknown=JSON.parse(String(payload));if(!Array.isArray(records))throw Error('Invalid announcement projection');
                for(const record of records){
                    if(!Array.isArray(record)||record.length!==3||record.some(value=>typeof value!=='string')||shardFor(record[0])!==shard||ids.has(record[0]))throw Error('Invalid announcement row');
                    const data=decodePayload(record[1]);if(data.companyId!==company)throw Error('Unexpected announcement company');
                    ids.add(record[0]);result.push({id:record[0],data,version:decode(JSON.parse(record[2])) as Timestamp});
                }
            }
            if([...markers].some(key=>!seen.has(key))||[...present].some(([key,projection])=>seen.has(key)&&!seen.has(projection)))throw Error('Incomplete announcement projection');
            return result;
        }));
    }
    private async publishCalendar(prefixPath:string,prefixFile:string,required:string[]) {
        const path=prefixPath+'.calendar.parquet';
        await withDuck(async db=>{
            await db.run(`COPY (SELECT field,payload FROM read_parquet(${quote(prefixPath)}) WHERE field=${quote(CALENDAR_LOOKUP)} OR starts_with(field,${quote(CALENDAR_LOOKUP+':')})) TO ${quote(path)} (FORMAT PARQUET,COMPRESSION ZSTD)`);
            const fields=new Set((await db.runAndReadAll(`SELECT field FROM read_parquet(${quote(path)})`)).getRows().map(([field])=>String(field)));
            if(required.some(field=>!fields.has(field)))throw Error('Missing published calendar projection');
        });
        await this.bucket.upload(path,{destination:calendarIndexFile(prefixFile),resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/vnd.apache.parquet'}});
    }
    private async publishAnnouncements(prefixPath:string,prefixFile:string,bundled:boolean,required:string[]){
        const paths=Array.from({length:16},(_,bucket)=>prefixPath+`.announcement-${bucket}.parquet`);
        await withDuck(async db=>{
            await db.run(`CREATE TEMP TABLE company_projections AS (${announcementIndexRows(prefixPath,bundled)})`);
            const markers=new Set((await db.runAndReadAll('SELECT field FROM company_projections WHERE bucket IS NULL')).getRows().map(([field])=>String(field)));
            if(required.some(field=>!markers.has(field)))throw Error('Missing published announcement projection');
            for(let bucket=0;bucket<16;bucket++)await db.run(`COPY (SELECT field,payload FROM company_projections WHERE bucket IS NULL OR bucket=${bucket}) TO ${quote(paths[bucket])} (FORMAT PARQUET,COMPRESSION ZSTD)`);
        });
        // Bound writer fan-out and settle uploads before deleting local files.
        for(let offset=0;offset<16;offset+=4){
            const outcomes=await Promise.allSettled(paths.slice(offset,offset+4).map((path,i)=>this.bucket.upload(path,{destination:announcementIndexFile(prefixFile,offset+i),resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/vnd.apache.parquet'}})));
            const failed=outcomes.find(outcome=>outcome.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
        }
    }
    private calendarRows(heads:MarketHead[]):Promise<MarketRow[]> {
        const active=heads.filter(head=>head.file);
        const key='calendar:'+createHash('sha256').update(JSON.stringify(active.map(head=>[head.shard,head.prefixFile,head.format]))).digest('hex');
        const old=this.queryBudget?this.queryResults.get(key):undefined;
        if(old){this.queryResults.delete(key);this.queryResults.set(key,old);return old.value;}
        const work=async()=>{
            if(active.some(head=>!head.prefixFile))throw Error('Missing calendar projection');
            const source=(head:MarketHead)=>marketIndexFormat(head.format)>=11?calendarIndexFile(head.prefixFile!):head.prefixFile!;
            const names=[...new Set(active.map(source))];for(const name of names)this.validate(name);
            const wanted=new Map(active.map(head=>[source(head)+'|'+(marketIndexBundled(head.format)?CALENDAR_LOOKUP+':'+head.shard:CALENDAR_LOOKUP),head.shard]));
            return this.local(names,paths=>withDuck(async db=>{
                const originals=new Map(paths.map((path,i)=>[path.replaceAll('\\','/'),names[i]]));
                const fields=[...new Set(active.map(head=>marketIndexBundled(head.format)?CALENDAR_LOOKUP+':'+head.shard:CALENDAR_LOOKUP))];
                const rows=(await db.runAndReadAll(`SELECT filename,field,payload FROM read_parquet([${paths.map(quote).join(',')}],filename=true) WHERE field IN (${fields.map(quote).join(',')})`)).getRows();
                const found=new Set<string>(),result:MarketRow[]=[];
                for(const [filename,field,payload] of rows){
                    const name=originals.get(String(filename).replaceAll('\\','/')),identity=name+'|'+field,shard=wanted.get(identity);
                    if(!shard)continue;if(found.has(identity))throw Error('Duplicate calendar projection');found.add(identity);
                    const records:unknown=JSON.parse(String(payload));if(!Array.isArray(records))throw Error('Invalid calendar projection');
                    for(const record of records){
                        if(!Array.isArray(record)||record.length!==3||record.some(value=>typeof value!=='string')||shardFor(record[0])!==shard)throw Error('Invalid calendar row');
                        const data=decodePayload(record[1]);if(data.type!=='scheduled_event')throw Error('Invalid calendar event type');
                        result.push({id:record[0],data,version:decode(JSON.parse(record[2])) as Timestamp});
                    }
                }
                if(found.size!==wanted.size)throw Error('Incomplete calendar projection');return result;
            }));
        };
        if(!active.length)return Promise.resolve([]);
        const entry={value:work(),bytes:0};if(this.queryBudget)this.remember(key,entry);return entry.value;
    }
    async query(heads: MarketHead[], steps: Step[], indexed = true, compactRead = false): Promise<MarketRow[]> {
        const limit=steps.find(step=>step.method==='limit'||step.method==='limitToLast')?.args[0];
        const identity=steps.find(step=>step.method==='where'&&fieldName(step.args[0])==='__name__'&&['==','in'].includes(String(step.args[1])));
        const selection=steps.find(step=>step.method==='select');
        const ids=identity?.args[1]==='=='?[identity.args[2]]:identity?.args[2];
        if(this.queryBudget&&indexed&&selection&&Array.isArray(ids)&&ids.length>0&&ids.length<=2048&&ids.every(id=>typeof id==='string')
            &&steps.filter(step=>step.method==='where').length===1&&steps.filter(step=>step.method==='select').length===1&&steps.every(step=>step.method==='where'||step.method==='select')
            &&heads.every(head=>head.collection===heads[0]?.collection)&&new Set(heads.map(head=>head.shard)).size===heads.length)
            return this.projectedDocuments(heads,ids as string[],selection);
        const bounded=typeof limit==='number'&&limit<=512||identity&&(identity.args[1]==='=='||Array.isArray(identity.args[2])&&identity.args[2].length<=512);
        if(!this.queryBudget||!bounded)return this.queryUncached(heads,steps,indexed,compactRead);
        // Only external values are cached here. Operational overlays are read and
        // merged by the repository on every invalidated query. Immutable file
        // identities change whenever the external contents change; a head's
        // retained IDs/revision alone must not force another DuckDB scan.
        const key=createHash('sha256').update(JSON.stringify([indexed,compileMarketQuery(steps),heads.map(head=>
            [head.collection,head.shard,head.file,head.indexFile,head.prefixFile,head.format])])).digest('hex');
        const old=this.queryResults.get(key);
        if(old){this.queryResults.delete(key);this.queryResults.set(key,old);return old.value;}
        const entry={value:this.queryUncached(heads,steps,indexed,compactRead),bytes:0};
        this.remember(key,entry);
        return entry.value;
    }
    private async projectedDocuments(heads:MarketHead[],ids:string[],selection:Step){
        const byShard=new Map(heads.map(head=>[head.shard,head]));
        const ordered=[...new Set(ids)].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
        const keys=ordered.map(id=>{const head=byShard.get(shardFor(id));return 'd:'+createHash('sha256').update(JSON.stringify([
            head?.collection??heads[0]?.collection,id,head?.file,head?.indexFile,head?.prefixFile,head?.format,selection.args.map(fieldName),
        ])).digest('hex');});
        const found=keys.map(key=>{const entry=this.queryResults.get(key);if(entry){this.queryResults.delete(key);this.queryResults.set(key,entry);}return entry;});
        const missing=ordered.filter((_,i)=>!found[i]);
        if(missing.length){
            const loaded=this.queryUncached(heads,[{method:'where',args:['__name__','in',missing]},selection],true).then(rows=>new Map(rows.map(row=>[row.id,row])));
            ordered.forEach((id,i)=>{if(found[i])return;const entry={value:loaded.then(rows=>{const row=rows.get(id);return row?[row]:[];}),bytes:0};found[i]=entry;this.remember(keys[i],entry);});
        }
        return (await Promise.all(found.map(entry=>entry!.value))).flat();
    }
    private remember(key:string,entry:{value:Promise<MarketRow[]>;bytes:number}){
        this.queryResults.set(key,entry);
        void entry.value.then(rows=>{
            // Broad scans have their own page cache. Never serialize an entire
            // directory merely to discover it cannot fit, or evict hot searches
            // to make room for an entry larger than the whole result budget.
            let size=256;
            for(const row of rows){size+=Buffer.byteLength(JSON.stringify(row))*2;if(size>this.queryBudget)break;}
            if(size>this.queryBudget){if(this.queryResults.get(key)===entry)this.queryResults.delete(key);return;}
            if(this.queryResults.get(key)!==entry)return;
            entry.bytes=size;
            let bytes=[...this.queryResults.values()].reduce((n,item)=>n+item.bytes,0);
            let queries=[...this.queryResults.keys()].filter(id=>!id.startsWith('d:')).length;
            for(const [id,item] of this.queryResults){
                if(bytes<=this.queryBudget&&this.queryResults.size<=8192&&queries<=256)break;
                if(bytes<=this.queryBudget&&this.queryResults.size<=8192&&id.startsWith('d:'))continue;
                this.queryResults.delete(id);bytes-=item.bytes;if(!id.startsWith('d:'))queries--;
            }
        }).catch(()=>{if(this.queryResults.get(key)===entry)this.queryResults.delete(key);});
    }
    private async queryUncached(heads: MarketHead[], steps: Step[], indexed: boolean, compactRead = false): Promise<MarketRow[]> {
        const calendar=steps.some(step=>step.method==='where'&&fieldName(step.args[0])==='type'&&
            (step.args[1]==='=='&&step.args[2]==='scheduled_event'||step.args[1]==='in'&&Array.isArray(step.args[2])&&step.args[2].length>0&&step.args[2].every(value=>value==='scheduled_event')));
        if(indexed&&calendar&&heads.every(head=>head.collection==='events'&&(!head.file||marketIndexFormat(head.format)>=8)))
            return this.filter(await this.calendarRows(heads),steps);
        const planned=indexed&&heads.length&&heads.every(head=>head.collection==='events')?announcementPlan(steps):undefined;
        if(planned&&heads.some(head=>head.file&&marketIndexFormat(head.format)>=7)&&heads.some(head=>head.file&&marketIndexFormat(head.format)<7)){
            // An older live writer may replace one shard during rollout. Keep
            // its SQL fallback local to that shard instead of rescanning every
            // upgraded index. Each side supplies enough rows for the final page.
            const candidates=steps.filter(step=>step.method!=='offset').map(step=>step.method==='limit'?{method:'limit',args:[planned.limit+planned.offset]}:step.method==='select'?{method:'select',args:[...step.args,'companyId','publication_date']}:step);
            const sides=await Promise.all([heads.filter(head=>marketIndexFormat(head.format)>=7),heads.filter(head=>marketIndexFormat(head.format)<7)].map(group=>this.queryUncached(group,candidates,indexed,compactRead)));
            return this.filter(sides.flat(),steps);
        }
        const announcement=planned&&heads.every(head=>!head.file||marketIndexFormat(head.format)>=7)?planned:undefined;
        if(announcement){
            if(heads.some(head=>head.file&&!head.prefixFile))throw Error('Missing announcement index');
            const indexedHeads=heads.filter(head=>head.file&&head.prefixFile);
            const projection=steps.find(step=>step.method==='select');
            if(projection&&indexedHeads.every(head=>marketIndexFormat(head.format)>=10)&&projection.args.every(field=>marketIndexProjectionField(fieldName(field),10)))
                return this.filter(await this.announcementRows(indexedHeads,announcement.company),steps);
            const matches=await this.announcementMatches(indexedHeads.filter(head=>marketIndexFormat(head.format)>=9),announcement.company);
            const files=indexedHeads.filter(head=>marketIndexFormat(head.format)<9);
            for(let start=0;start<files.length;start+=128){
                const group=files.slice(start,start+128),key=(head:MarketHead)=>this.prefixKey(head,ANNOUNCEMENT_LOOKUP);
                const missing=group.filter(head=>!this.announcementPrefixes.has(key(head)));
                for(const head of missing)this.validate(head.prefixFile!);
                let pending:Promise<Map<string,PrefixLookup>>|undefined;
                const load=()=>pending??=this.loadPrefixes(missing,ANNOUNCEMENT_LOOKUP,true);
                matches.push(...(await Promise.all(group.map(head=>this.announcementPrefixes.matching(key(head),announcement.company,async()=>{const lookup=(await load()).get(key(head));if(!lookup)throw Error('Missing announcement lookup');return lookup;})))).flat());
            }
            const ids=announcementIds(matches,announcement);if(!ids.length)return [];
            const rows=await this.query(heads,[{method:'where',args:['__name__','in',ids]},...steps.filter(step=>step.method==='select')]);
            const byId=new Map(rows.map(row=>[row.id,row]));
            return ids.map(id=>{const row=byId.get(id);if(!row)throw Error('Announcement index references missing row');return row;});
        }
        const prefix=steps.find(step=>step.method==='where'&&step.args[1]==='array-contains'&&searchPayload.has(fieldName(step.args[0]))&&typeof step.args[2]==='string'&&step.args[2].length>0&&!step.args[2].includes('\0'));
        if(prefix&&heads.every(head=>!head.file||marketIndexFormat(head.format)>=2)){
            const matches:string[]=[],field=fieldName(prefix.args[0]),groups:MarketHead[][]=[];let group:MarketHead[]=[],bytes=0;const counted=new Set<string>();
            for(const head of heads){if(!head.file||(marketIndexFormat(head.format)>=5&&!head.prefixFile))continue;this.validate(head.file);if(head.prefixFile)this.validate(head.prefixFile);const name=head.prefixFile??head.file,size=(head.prefixFile?head.prefixBytes:head.bytes)??8*1024*1024;
                const modern=!!head.prefixFile,limit=modern?32*1024*1024:8*1024*1024;
                if(group.length&&(!!group[0].prefixFile!==modern||group.length>=(modern?128:16)||bytes+(counted.has(name)?0:size)>limit)){groups.push(group);group=[];bytes=0;counted.clear();}group.push(head);if(!counted.has(name)){bytes+=size;counted.add(name);}
            }if(group.length)groups.push(group);
            for(const group of groups){
                const key=(head:MarketHead)=>head.prefixFile?this.prefixKey(head,field):head.file+'|'+field;
                const missing=group.filter(head=>!this.prefixes.has(key(head)));
                let pending:Promise<Map<string,PrefixRows|PrefixLookup>>|undefined;
                const modern=!!group[0].prefixFile;
                const load=()=>pending??=modern?this.loadPrefixes(missing,field):this.local(missing.map(head=>head.file!),paths=>withDuck(async db=>{
                    const names=new Map(paths.map((path,i)=>[path.replaceAll('\\','/'),missing[i].file!]));
                    const found=new Map<string,PrefixRows|PrefixLookup>();
                    const rows=(await db.runAndReadAll(`SELECT filename,${modern?'field,payload':`id,json_extract(payload,${quote('$.'+JSON.stringify(field))})`} FROM read_parquet([${paths.map(quote).join(',')}],filename=true)${modern?` WHERE field=${quote(field)}`:''}`)).getRows();
                    for(const [filename,id,values] of rows){const name=names.get(String(filename).replaceAll('\\','/'));if(!name)throw Error('Unexpected prefix index file');
                        if(modern)found.set(name,decodePrefixLookup(String(values)));
                        else{const entries=(found.get(name)??[]) as PrefixRows;entries.push({id:String(id),values:values==null?undefined:decodeMarket(JSON.parse(String(values)))});found.set(name,entries);}
                    }
                    return found;
                }));
                const selected=await Promise.all(group.map(head=>this.prefixes.matching(key(head),prefix.args[2] as string,async()=>(await load()).get(modern?key(head):head.file!)??[])));
                matches.push(...selected.flat());
            }
            if(!matches.length)return [];
            const rest=steps.filter(step=>step!==prefix);
            if(rest.every(step=>['select','limit','offset'].includes(step.method))){
                // Membership establishes the whole predicate. Apply its ID ordering
                // and page bounds before fetching payloads for a broad prefix.
                const query=compileMarketQuery(steps),ids=[...new Set(matches)].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).slice(query.offset,query.limit===undefined?undefined:query.offset+query.limit);
                if(!ids.length)return [];
                return this.query(heads,[{method:'where',args:['__name__','in',ids]},...rest.filter(step=>step.method==='select')],indexed);
            }
            return this.query(heads,[{method:'where',args:['__name__','in',[...new Set(matches)]]},...rest],indexed);
        }
        const predicates = steps.filter(step=>['where','orderBy'].includes(step.method));
        const selection=steps.find(step=>step.method==='select');
        const directIds=predicates.some(step=>step.method==='where'&&fieldName(step.args[0])==='__name__'&&['==','in'].includes(String(step.args[1])))&&predicates.every(step=>fieldName(step.args[0])==='__name__');
        const compactProjection=selection&&heads.every(head=>!head.file||selection.args.every(field=>marketIndexProjectionField(fieldName(field),head.format??0)));
        if(indexed && !(directIds&&!compactProjection) && heads.every(head=>!head.file||head.indexFile) && predicates.every(step=>marketIndexField(fieldName(step.args[0])))) {
            const compact=heads.map(head=>({...head,file:head.indexFile,bytes:head.indexBytes,format:marketIndexBundled(head.format)?head.format:2,indexFile:undefined}));
            // Calendar records are sparse among hundreds of thousands of news
            // events. Their complete external values fit in the compact index.
            const calendar=predicates.some(step=>step.method==='where'&&fieldName(step.args[0])==='type'&&
                (step.args[1]==='=='&&step.args[2]==='scheduled_event'||step.args[1]==='in'&&Array.isArray(step.args[2])&&step.args[2].length>0&&step.args[2].every(value=>value==='scheduled_event')));
            if(calendar&&heads.every(head=>!head.file||marketIndexFormat(head.format)>=4))return this.query(compact,steps,false,true);
            if(compactProjection)
                return this.query(compact,steps,false,true);
            const identities=await this.query(compact,[...steps.filter(step=>step.method!=='select'),{method:'select',args:[]}],false,true);
            if(!identities.length)return [];
            const payloads=await this.query(heads,[{method:'where',args:['__name__','in',identities.map(row=>row.id)]},...(selection?[selection]:[])],false);
            const byId=new Map(payloads.map(row=>[row.id,row]));
            return identities.map(row=>{const payload=byId.get(row.id);if(!payload)throw Error('Parquet index references a missing row');return payload;});
        }
        const query = compileMarketQuery(steps);
        const names = steps.find(step => step.method === 'where' && fieldName(step.args[0]) === '__name__' && ['==', 'in'].includes(String(step.args[1])));
        const shards = names ? new Set((names.args[1] === 'in' ? names.args[2] as string[] : [String(names.args[2])]).map(shardFor)) : undefined;
        const files = heads.filter(head => head.file && (!shards || shards.has(head.shard)));
        for (const head of files)
            this.validate(head.file!);
        const groups: MarketHead[][] = [];
        let group: MarketHead[] = [], bytes = 0;
        const byFile=new Map<string,MarketHead[]>();
        for(const head of files){const shared=byFile.get(head.file!)??[];shared.push(head);byFile.set(head.file!,shared);}
        for (const shared of byFile.values()) {
            const head=shared[0];
            const size = head.bytes ?? 8 * 1024 * 1024;
            // Compact indexes contain bounded response fields, without article
            // captures or prefix arrays. Larger groups reduce repeated scans
            // within the web service's existing file-cache/memory budget.
            if (group.length && (bytes + size > (this.web ? compactRead ? 128 : 32 : 8) * 1024 * 1024
                || names && compactRead && (marketIndexBundled(head.format)||group.some(item=>marketIndexBundled(item.format))) && new Set(group.map(item=>item.file)).size>=4)) {
                groups.push(group);
                group = [];
                bytes = 0;
            }
            group.push(...shared);
            bytes += size;
        }
        if (group.length)
            groups.push(group);
        const candidates: MarketRow[] = [];
        // Bound pinned disk pages: Cloud Run's writable filesystem shares its memory budget.
        for (const group of groups) {
            const names=[...new Set(group.map(head => head.file!))];
            const rows = await this.local(names, localPaths => withDuck(async (db) => {
                const paths=localPaths.map(path=>path.replaceAll('\\','/'));
                const compiled = compileMarketQuery(steps, group.every(head => marketIndexFormat(head.format) >= 2));
                const roots = [...new Set([...(query.selection ?? []), ...steps.filter(step => ['where', 'orderBy'].includes(step.method)).map(step => fieldName(step.args[0]))].map(field => field.split('.')[0]).filter(field => field !== '__name__'))];
                // A single-group projection can discard large search indexes in DuckDB,
                // before allocating JavaScript documents. Older bootstrap files still read.
                const source = group.every(head => marketIndexFormat(head.format) >= 2) && !roots.some(root => searchPayload.has(root)) ? 'view_payload' : 'payload';
                const payload = query.selection !== undefined ? `CASE WHEN json_type(${source})='OBJECT' THEN json_object(${roots.flatMap(root => [quote(root), `coalesce(json_extract(${source},${quote('$.' + JSON.stringify(root))}),'["undefined"]'::JSON)`]).join(',')}) ELSE ${source} END` : 'payload';
                // A shared index may also contain shards whose heads now point
                // at newer files. Read only the shards represented by this group.
                const bundled=compactRead&&group.some(head=>marketIndexBundled(head.format));
                // Separate file scans let DuckDB push identity filters into each
                // Parquet reader instead of evaluating a filename OR expression.
                const identityScan=bundled&&!!shards;
                const scan=identityScan?`(${paths.map((path,i)=>`SELECT * FROM read_parquet(${quote(path)}) WHERE substr(sha256(id),1,2) IN (${group.filter(head=>head.file===names[i]).map(head=>quote(head.shard)).join(',')})`).join(' UNION ALL BY NAME ')})`:`read_parquet([${paths.map(quote).join(',')}],union_by_name=true${bundled?',filename=true':''})`;
                const scope=bundled&&!identityScan?` AND (${paths.map((path,i)=>`(filename=${quote(path)} AND substr(sha256(id),1,2) IN (${group.filter(head=>head.file===names[i]).map(head=>quote(head.shard)).join(',')}))`).join(' OR ')})`:'';
                const sql = `SELECT id,${payload},version FROM ${scan} WHERE (${compiled.where})${scope} ORDER BY ${compiled.order}${query.limit === undefined ? '' : ` LIMIT ${query.limit + query.offset}`}`;
                return (await db.runAndReadAll(sql)).getRows().map(([id, payload, version]) => ({ id: String(id), data: decodePayload(String(payload)), version: decode(JSON.parse(String(version))) as Timestamp }));
            }));
            candidates.push(...rows);
        }
        if (groups.length === 1) {
            let result = candidates.slice(query.offset, query.limit === undefined ? undefined : query.offset + query.limit);
            if (query.last)
                result.reverse();
            if (query.selection)
                result = result.map(row => ({ ...row, data: project(row.data, query.selection!) }));
            return result;
        }
        return this.filter(candidates, steps);
    }
    async hydrate(row: MarketRow): Promise<MarketRow> { return { ...row, data: await hydrateMarket(row.data, this.bucket) }; }
    async filter(rows: MarketRow[], steps: Step[]): Promise<MarketRow[]> {
        if (!rows.length)
            return [];
        const query = compileMarketQuery(steps);
        const identityOrdered=filterIdentityOrdered(rows,steps);if(identityOrdered)return identityOrdered;
        const predicates=steps.filter(step=>step.method==='where'),prefix=predicates[0];
        // A company's already-loaded revisions need only equality and ID ordering.
        // Do not enqueue this small merge behind unrelated Parquet scans.
        if(predicates.length===1&&fieldName(prefix.args[0])==='companyId'&&prefix.args[1]==='=='&&typeof prefix.args[2]==='string'
            &&/^[A-Za-z0-9:._-]+$/.test(prefix.args[2])&&steps.every(step=>['where','select','limit','offset'].includes(step.method))){
            const selected=rows.filter(row=>row.data.companyId===prefix.args[2]).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(query.offset,query.limit===undefined?undefined:query.offset+query.limit);
            return query.selection?selected.map(row=>({...row,data:project(row.data,query.selection!)})):selected;
        }
        if(predicates.length===1&&prefix.args[1]==='array-contains'&&searchPayload.has(fieldName(prefix.args[0]))&&typeof prefix.args[2]==='string'&&steps.every(step=>['where','select','limit','offset'].includes(step.method))){
            const field=fieldName(prefix.args[0]),selected=rows.filter(row=>Array.isArray(row.data[field])&&(row.data[field] as unknown[]).includes(prefix.args[2])).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(query.offset,query.limit===undefined?undefined:query.offset+query.limit);
            return query.selection?selected.map(row=>({...row,data:project(row.data,query.selection!)})):selected;
        }
        // The merged rows retain full response payloads, but DuckDB only needs
        // predicate/order keys to choose them. Indexing unrelated prefix arrays,
        // article bodies and evidence blocks can monopolize the request thread.
        const filterFields=[...new Set(steps.filter(step=>step.method==='where'||step.method==='orderBy').map(step=>fieldName(step.args[0])))].filter(field=>field!=='__name__');
        const selected = await withDuck(async (db) => {
            await db.run('CREATE TABLE records (id VARCHAR, keys JSON, arrays JSON, position INTEGER)');
            const appender = await db.createAppender('records');
            try {
                for (let i = 0; i < rows.length; i++) {
                    const index = queryIndex(project(rows[i].data,filterFields));
                    appender.appendVarchar(rows[i].id);
                    appender.appendVarchar(JSON.stringify(index.keys));
                    appender.appendVarchar(JSON.stringify(index.arrays));
                    appender.appendInteger(i);
                    appender.endRow();
                }
            }
            finally {
                appender.closeSync();
            }
            return (await db.runAndReadAll(`SELECT position FROM records WHERE ${query.where} ORDER BY ${query.order}${query.limit === undefined ? '' : ` LIMIT ${query.limit}`} OFFSET ${query.offset}`)).getRows().map(([position]) => rows[Number(position)]);
        });
        if (query.last)
            selected.reverse();
        return query.selection ? selected.map(row => ({ ...row, data: project(row.data, query.selection!) })) : selected;
    }
    /** Combine immutable read indexes without changing data shards or ownership.
     * Callers must publish the returned heads with a compare-and-swap transaction. */
    async bundleIndexes(heads:MarketHead[]):Promise<MarketHead[]>{
        if(!heads.length||heads.length>16||new Set(heads.map(head=>head.shard)).size!==heads.length
            ||heads.some(head=>head.collection!==heads[0].collection||!head.file||!head.indexFile||marketIndexFormat(head.format)<3||marketIndexFormat(head.format)>12))throw Error('Invalid index bundle');
        const directory=await mkdtemp(join(tmpdir(),'ya-market-bundle-')),indexPath=join(directory,'index.parquet'),prefixPath=join(directory,'prefix.parquet');
        const destination=()=>`${MARKET_ROOT}/data/${heads[0].collection}/${heads[0].shard}/${randomUUID()}.parquet`;
        const names=[...new Set(heads.flatMap(head=>[head.indexFile!,...(head.prefixFile?[head.prefixFile]:[])]))];
        for(const name of names)this.validate(name);
        try{
            await this.local(names,paths=>withDuck(async db=>{
                // Exact bundle parity can exceed the small query memory limit.
                // Cloud Run's writable disk uses memory: bound scratch space and
                // keep it inside this operation's temporary directory for cleanup.
                await db.run(`SET temp_directory=${quote(join(directory,'scratch'))}`);
                await db.run("SET max_temp_directory_size='256MB'");
                await db.run('SET preserve_insertion_order=false');
                const local=new Map(names.map((name,i)=>[name,paths[i]]));
                const indexNames=[...new Set(heads.map(head=>head.indexFile!))];
                const source=indexNames.map(name=>`SELECT * FROM read_parquet(${quote(local.get(name)!)}) WHERE substr(sha256(id),1,2) IN (${heads.filter(head=>head.indexFile===name).map(head=>quote(head.shard)).join(',')})`).join(' UNION ALL BY NAME ');
                await db.run(`COPY (${source}) TO ${quote(indexPath)} (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 2048)`);
                // Compare every shard exactly, without building a hash table for
                // the entire bundle at once. Counts below reject extra shards.
                for(const head of heads){
                    const scope=`substr(sha256(id),1,2)=${quote(head.shard)}`;
                    const [[difference]]=(await db.runAndReadAll(`WITH original AS (SELECT * FROM (${source}) WHERE ${scope}), bundled AS (SELECT * FROM read_parquet(${quote(indexPath)}) WHERE ${scope}), differences AS ((SELECT * FROM original EXCEPT ALL SELECT * FROM bundled) UNION ALL (SELECT * FROM bundled EXCEPT ALL SELECT * FROM original)) SELECT count(*) FROM differences`)).getRows();
                    if(Number(difference)!==0)throw Error('Index bundle parity failed');
                }
                const counts=new Map((await db.runAndReadAll(`SELECT substr(sha256(id),1,2),count(*) FROM read_parquet(${quote(indexPath)}) GROUP BY 1`)).getRows().map(([shard,count])=>[String(shard),Number(count)]));
                if([...counts.keys()].some(shard=>!heads.some(head=>head.shard===shard))||heads.some(head=>(counts.get(head.shard)??0)!==head.rows))throw Error('Index bundle shard count mismatch');
                const prefixes=heads.filter(head=>head.prefixFile).map(head=>`SELECT ${marketIndexBundled(head.format)?'field':`field || ${quote(':'+head.shard)}`} AS field,payload FROM read_parquet(${quote(local.get(head.prefixFile!)!)})${marketIndexBundled(head.format)?` WHERE ends_with(field,${quote(':'+head.shard)})`:''}`).join(' UNION ALL ');
                if(prefixes){
                    await db.run(`COPY (${prefixes}) TO ${quote(prefixPath)} (FORMAT PARQUET,COMPRESSION ZSTD)`);
                    const [[changed]]=(await db.runAndReadAll(`WITH original AS (${prefixes}), differences AS ((SELECT * FROM original EXCEPT ALL SELECT * FROM read_parquet(${quote(prefixPath)})) UNION ALL (SELECT * FROM read_parquet(${quote(prefixPath)}) EXCEPT ALL SELECT * FROM original)) SELECT count(*) FROM differences`)).getRows();
                    if(Number(changed)!==0)throw Error('Prefix bundle parity failed');
                    const [[duplicate]]=(await db.runAndReadAll(`SELECT count(*)-count(DISTINCT field) FROM read_parquet(${quote(prefixPath)})`)).getRows();
                    if(Number(duplicate)!==0)throw Error('Duplicate bundled prefix');
                }
            }));
            const indexFile=destination(),indexBytes=(await import('node:fs/promises').then(fs=>fs.stat(indexPath))).size;
            await this.bucket.upload(indexPath,{destination:indexFile,resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/vnd.apache.parquet'}});
            let prefixFile:string|undefined,prefixBytes:number|undefined;
            if(heads.some(head=>head.prefixFile)){
                prefixFile=destination();prefixBytes=(await import('node:fs/promises').then(fs=>fs.stat(prefixPath))).size;
                await this.bucket.upload(prefixPath,{destination:prefixFile,resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/vnd.apache.parquet'}});
                if(heads[0].collection==='events'&&heads.some(head=>marketIndexFormat(head.format)>=11))await this.publishCalendar(prefixPath,prefixFile,heads.filter(head=>marketIndexFormat(head.format)>=11).map(head=>CALENDAR_LOOKUP+':'+head.shard));
                if(heads[0].collection==='events'&&heads.some(head=>marketIndexFormat(head.format)>=12))await this.publishAnnouncements(prefixPath,prefixFile,true,heads.filter(head=>marketIndexFormat(head.format)>=12).map(head=>ANNOUNCEMENT_LOOKUP+':'+head.shard));
            }
            return heads.map(head=>({...head,format:100+marketIndexFormat(head.format),indexFile,indexBytes,...(head.prefixFile?{prefixFile,prefixBytes}:{})}));
        }finally{await rm(directory,{recursive:true,force:true});}
    }
    async write(collection: MarketCollection, shard: string, rows: MarketRow[], retained: string[]): Promise<MarketHead> {
        if (!/^[a-z_]+$/.test(collection) || !/^[a-f0-9]{2}$/.test(shard))
            throw Error('Invalid market partition');
        if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => shardFor(row.id) !== shard))
            throw Error('Invalid market partition rows');
        const head: MarketHead = { collection, shard, rows: rows.length, retained: [...new Set(retained)].sort(), format: collection==='events'?12:7 };
        if (!rows.length)
            return head;
        const directory = await mkdtemp(join(tmpdir(), 'ya-market-')), path = join(directory, 'rows.parquet'), indexPath=join(directory,'index.parquet'),prefixPath=join(directory,'prefix.parquet');
        try {
            const prefixFields=[...searchPayload].filter(field=>rows.some(row=>Array.isArray(row.data[field])));
            const prefixRows=prefixFields.map(field=>[field,encodePrefixLookup(buildPrefixLookup(rows.map(row=>({id:row.id,values:row.data[field]}))))]);
            if(collection==='events'){
                const announcements=announcementLookup(rows),companies=new Map<string,string[]>();
                // Preserve the prior lookup for readers during a rolling release.
                prefixRows.push([ANNOUNCEMENT_LOOKUP,encodePrefixLookup(buildPrefixLookup(announcements))]);
                for(const row of announcements){const company=(row.values as string[])[0],ids=companies.get(company)??[];ids.push(row.id);companies.set(company,ids);}
                for(const [company,ids] of companies)prefixRows.push([ANNOUNCEMENT_COMPANY+company,JSON.stringify(ids)]);
            }
            const payloads: string[] = [], views: string[] = [], compactPayloads:string[]=[], compactIndexes:ReturnType<typeof queryIndex>[]=[];
            for (const row of rows) {
                const fields: Data = {};
                for (const [key, value] of Object.entries(row.data))
                    fields[key] = await encodeMarket(value, this.bucket);
                payloads.push(JSON.stringify(fields));
                views.push(JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([key]) => !searchPayload.has(key)))));
                const compact=row.data.type==='scheduled_event'?row.data:project(row.data,[...MARKET_INDEX_FIELDS,...MARKET_INDEX_PAYLOAD_FIELDS]), compactWire:Data={};
                for(const [key,value] of Object.entries(compact))compactWire[key]=await encodeMarket(value,this.bucket);
                compactPayloads.push(JSON.stringify(compactWire));
                compactIndexes.push(queryIndex(project(compact,[...MARKET_INDEX_FIELDS])));
            }
            if(collection==='events')prefixRows.push([CALENDAR_LOOKUP,JSON.stringify(rows.flatMap((row,i)=>row.data.type==='scheduled_event'?[[row.id,payloads[i],JSON.stringify(encode(row.version))]]:[]))]);
            if(collection==='events'){
                const companies=new Map<string,string[][]>();
                for(const [i,row] of rows.entries()){
                    if(!announcementLookup([row]).length)continue;
                    const company=String(row.data.companyId),records=companies.get(company)??[];
                    records.push([row.id,compactPayloads[i],JSON.stringify(encode(row.version))]);companies.set(company,records);
                }
                for(const [company,records] of companies)prefixRows.push([ANNOUNCEMENT_RECORDS+company,JSON.stringify(records)]);
            }
            await withDuck(async (db) => {
                await db.run('CREATE TABLE records (id VARCHAR,payload VARCHAR,version VARCHAR,keys JSON,arrays JSON,view_payload VARCHAR,view_keys JSON,index_payload VARCHAR,index_keys JSON,index_arrays JSON)');
                const appender = await db.createAppender('records');
                try {
                    for (const [i, row] of rows.entries()) {
                        const index = queryIndex(row.data);
                        appender.appendVarchar(row.id);
                        appender.appendVarchar(payloads[i]);
                        appender.appendVarchar(JSON.stringify(encode(row.version)));
                        appender.appendVarchar(JSON.stringify(index.keys));
                        appender.appendVarchar(JSON.stringify(index.arrays));
                        appender.appendVarchar(views[i]);
                        appender.appendVarchar(JSON.stringify(Object.fromEntries(Object.entries(index.keys).filter(([key]) => !searchPayload.has(key.split('.')[0])))));
                        const lookup=compactIndexes[i];
                        appender.appendVarchar(compactPayloads[i]);
                        appender.appendVarchar(JSON.stringify(lookup.keys));
                        appender.appendVarchar(JSON.stringify(lookup.arrays));
                        appender.endRow();
                    }
                }
                finally {
                    appender.closeSync();
                }
                await db.run(`COPY (SELECT id,payload,version,keys,arrays,view_payload,view_keys FROM records ORDER BY id) TO ${quote(path)} (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 2048)`);
                await db.run(`COPY (SELECT id,index_payload AS payload,version,index_keys AS keys,index_arrays AS arrays,index_payload AS view_payload,index_keys AS view_keys FROM records ORDER BY id) TO ${quote(indexPath)} (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 2048)`);
                if(prefixRows.length){
                    await db.run('CREATE TABLE prefix_records (field VARCHAR,payload VARCHAR)');const prefixAppender=await db.createAppender('prefix_records');
                    try{for(const [field,payload] of prefixRows){prefixAppender.appendVarchar(field);prefixAppender.appendVarchar(payload);prefixAppender.endRow();}}finally{prefixAppender.closeSync();}
                    await db.run(`COPY prefix_records TO ${quote(prefixPath)} (FORMAT PARQUET,COMPRESSION ZSTD)`);
                }
                const check = await db.runAndReadAll(`SELECT count(*) FROM read_parquet(${quote(path)})`);
                if (Number(check.getRows()[0][0]) !== rows.length)
                    throw Error('Market Parquet count mismatch');
            });
            head.file = `${MARKET_ROOT}/data/${collection}/${shard}/${randomUUID()}.parquet`;
            head.indexFile = `${MARKET_ROOT}/data/${collection}/${shard}/${randomUUID()}.parquet`;
            head.bytes = (await import('node:fs/promises').then(fs => fs.stat(path))).size;
            head.indexBytes = (await import('node:fs/promises').then(fs => fs.stat(indexPath))).size;
            await this.bucket.upload(path, { destination: head.file, resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/vnd.apache.parquet' } });
            await this.bucket.upload(indexPath, { destination: head.indexFile, resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/vnd.apache.parquet' } });
            if(prefixRows.length){head.prefixFile=`${MARKET_ROOT}/data/${collection}/${shard}/${randomUUID()}.parquet`;head.prefixBytes=(await import('node:fs/promises').then(fs=>fs.stat(prefixPath))).size;await this.bucket.upload(prefixPath,{destination:head.prefixFile,resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/vnd.apache.parquet'}});if(collection==='events'){await this.publishCalendar(prefixPath,head.prefixFile,[CALENDAR_LOOKUP]);await this.publishAnnouncements(prefixPath,head.prefixFile,false,[ANNOUNCEMENT_LOOKUP]);}}
            return head;
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
}
