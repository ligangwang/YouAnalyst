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
const searchPayload = new Set(['searchPrefixes', 'searchTerms', 'namePrefixes', 'symbolPrefixes']);
const decodePayload = (payload: string): Data => { const wire = JSON.parse(payload); return Array.isArray(wire) ? decodeMarket(wire) : Object.fromEntries(Object.entries(wire).map(([key, value]) => [key, decodeMarket(value)])); };
export class MarketFiles {
    private cache: PriceStore;
    private prefixes=new PrefixCache();
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
        this.cache = new PriceStore(bucket, (this.web ? 512 : 64) * 1024 * 1024-queryBudget);
    }
    close() { this.queryResults.clear();this.prefixes.clear();return this.cache.close(); }
    private async local<T>(names: string[], work: (paths: string[]) => Promise<T>): Promise<T> {
        const paths: string[] = [], holds: Promise<unknown>[] = [];
        let release!: () => void;
        const done = new Promise<void>(resolve => { release = resolve; });
        try {
            for (let start = 0; start < names.length; start += 32) {
                await Promise.all(names.slice(start, start + 32).map((name, offset) => new Promise<void>((resolve, reject) => { const hold = this.cache.local([name], async ([path]) => { paths[start + offset] = path; resolve(); await done; }); hold.catch(reject); holds.push(hold); })));
            }
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
            const matches:string[]=[];
            const files=heads.filter(head=>head.file&&head.prefixFile);
            for(let start=0;start<files.length;start+=128){
                const group=files.slice(start,start+128),key=(head:MarketHead)=>this.prefixKey(head,ANNOUNCEMENT_LOOKUP);
                const missing=group.filter(head=>!this.prefixes.has(key(head)));
                for(const head of missing)this.validate(head.prefixFile!);
                let pending:Promise<Map<string,PrefixLookup>>|undefined;
                const load=()=>pending??=this.loadPrefixes(missing,ANNOUNCEMENT_LOOKUP,true);
                matches.push(...(await Promise.all(group.map(head=>this.prefixes.matching(key(head),announcement.company,async()=>{const lookup=(await load()).get(key(head));if(!lookup)throw Error('Missing announcement lookup');return lookup;})))).flat());
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
                || compactRead && (marketIndexBundled(head.format)||group.some(item=>marketIndexBundled(item.format))) && new Set(group.map(item=>item.file)).size>=4)) {
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
                const scan=bundled?`(${paths.map((path,i)=>`SELECT * FROM read_parquet(${quote(path)}) WHERE substr(sha256(id),1,2) IN (${group.filter(head=>head.file===names[i]).map(head=>quote(head.shard)).join(',')})`).join(' UNION ALL BY NAME ')})`:`read_parquet([${paths.map(quote).join(',')}],union_by_name=true)`;
                const sql = `SELECT id,${payload},version FROM ${scan} WHERE (${compiled.where}) ORDER BY ${compiled.order}${query.limit === undefined ? '' : ` LIMIT ${query.limit + query.offset}`}`;
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
            ||heads.some(head=>head.collection!==heads[0].collection||!head.file||!head.indexFile||marketIndexFormat(head.format)<3||marketIndexFormat(head.format)>7))throw Error('Invalid index bundle');
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
            }
            return heads.map(head=>({...head,format:100+marketIndexFormat(head.format),indexFile,indexBytes,...(head.prefixFile?{prefixFile,prefixBytes}:{})}));
        }finally{await rm(directory,{recursive:true,force:true});}
    }
    async write(collection: MarketCollection, shard: string, rows: MarketRow[], retained: string[]): Promise<MarketHead> {
        if (!/^[a-z_]+$/.test(collection) || !/^[a-f0-9]{2}$/.test(shard))
            throw Error('Invalid market partition');
        if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => shardFor(row.id) !== shard))
            throw Error('Invalid market partition rows');
        const head: MarketHead = { collection, shard, rows: rows.length, retained: [...new Set(retained)].sort(), format: 7 };
        if (!rows.length)
            return head;
        const directory = await mkdtemp(join(tmpdir(), 'ya-market-')), path = join(directory, 'rows.parquet'), indexPath=join(directory,'index.parquet'),prefixPath=join(directory,'prefix.parquet');
        try {
            const prefixFields=[...searchPayload].filter(field=>rows.some(row=>Array.isArray(row.data[field])));
            const prefixRows=prefixFields.map(field=>[field,encodePrefixLookup(buildPrefixLookup(rows.map(row=>({id:row.id,values:row.data[field]}))))]);
            if(collection==='events')prefixRows.push([ANNOUNCEMENT_LOOKUP,encodePrefixLookup(buildPrefixLookup(announcementLookup(rows)))]);
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
            if(prefixRows.length){head.prefixFile=`${MARKET_ROOT}/data/${collection}/${shard}/${randomUUID()}.parquet`;head.prefixBytes=(await import('node:fs/promises').then(fs=>fs.stat(prefixPath))).size;await this.bucket.upload(prefixPath,{destination:head.prefixFile,resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/vnd.apache.parquet'}});}
            return head;
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
}
