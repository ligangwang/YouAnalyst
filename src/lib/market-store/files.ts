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
import { compileMarketQuery, project, type Step } from './query';
import type { MarketCollection } from './policy';
import { encodeMarket, decodeMarket, hydrateMarket } from './blobs';
import { MARKET_INDEX_FIELDS, marketIndexField } from './index-fields';
import {PrefixCache,buildPrefixLookup,encodePrefixLookup,decodePrefixLookup,type PrefixRows,type PrefixLookup} from './prefix-cache';
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
    // The 6 GiB web service can retain the compact market working set. Smaller
    // workers keep their original limit; all caches remain bounded.
    private readonly web = ['ifindata-web', 'market-parquet-ui-probe'].includes(process.env.K_SERVICE ?? '');
    constructor(readonly bucket: Bucket) { this.cache = new PriceStore(bucket, (this.web ? 512 : 64) * 1024 * 1024); }
    close() { this.prefixes.clear();return this.cache.close(); }
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
    async query(heads: MarketHead[], steps: Step[], indexed = true): Promise<MarketRow[]> {
        const prefix=steps.find(step=>step.method==='where'&&step.args[1]==='array-contains'&&searchPayload.has(fieldName(step.args[0]))&&typeof step.args[2]==='string'&&step.args[2].length>0&&!step.args[2].includes('\0'));
        if(prefix&&heads.every(head=>!head.file||(head.format??0)>=2)){
            const matches:string[]=[],field=fieldName(prefix.args[0]),groups:MarketHead[][]=[];let group:MarketHead[]=[],bytes=0;
            for(const head of heads){if(!head.file||((head.format??0)>=5&&!head.prefixFile))continue;this.validate(head.file);if(head.prefixFile)this.validate(head.prefixFile);const size=(head.prefixFile?head.prefixBytes:head.bytes)??8*1024*1024;
                const modern=!!head.prefixFile,limit=modern?32*1024*1024:8*1024*1024;
                if(group.length&&(!!group[0].prefixFile!==modern||group.length>=(modern?128:16)||bytes+size>limit)){groups.push(group);group=[];bytes=0;}group.push(head);bytes+=size;
            }if(group.length)groups.push(group);
            for(const group of groups){
                const missing=group.filter(head=>!this.prefixes.has(head.file+'|'+field));
                let pending:Promise<Map<string,PrefixRows|PrefixLookup>>|undefined;
                const modern=!!group[0].prefixFile;
                const load=()=>pending??=this.local(missing.map(head=>head.prefixFile??head.file!),paths=>withDuck(async db=>{
                    const names=new Map(paths.map((path,i)=>[path.replaceAll('\\','/'),missing[i].file!]));
                    const found=new Map<string,PrefixRows|PrefixLookup>();
                    const rows=(await db.runAndReadAll(`SELECT filename,${modern?'field,payload':`id,json_extract(payload,${quote('$.'+JSON.stringify(field))})`} FROM read_parquet([${paths.map(quote).join(',')}],filename=true)${modern?` WHERE field=${quote(field)}`:''}`)).getRows();
                    for(const [filename,id,values] of rows){const name=names.get(String(filename).replaceAll('\\','/'));if(!name)throw Error('Unexpected prefix index file');
                        if(modern)found.set(name,decodePrefixLookup(String(values)));
                        else{const entries=(found.get(name)??[]) as PrefixRows;entries.push({id:String(id),values:values==null?undefined:decodeMarket(JSON.parse(String(values)))});found.set(name,entries);}
                    }
                    return found;
                }));
                const selected=await Promise.all(group.map(head=>this.prefixes.matching(head.file+'|'+field,prefix.args[2] as string,async()=>(await load()).get(head.file!)??[])));
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
        const directIds=predicates.length>0&&predicates.every(step=>fieldName(step.args[0])==='__name__');
        const compactProjection=selection&&selection.args.every(field=>marketIndexField(fieldName(field)));
        if(indexed && !(directIds&&!compactProjection) && heads.every(head=>!head.file||head.indexFile) && predicates.every(step=>marketIndexField(fieldName(step.args[0])))) {
            const compact=heads.map(head=>({...head,file:head.indexFile,bytes:head.indexBytes,format:2,indexFile:undefined}));
            // Calendar records are sparse among hundreds of thousands of news
            // events. Their complete external values fit in the compact index.
            const calendar=predicates.some(step=>step.method==='where'&&fieldName(step.args[0])==='type'&&
                (step.args[1]==='=='&&step.args[2]==='scheduled_event'||step.args[1]==='in'&&Array.isArray(step.args[2])&&step.args[2].length>0&&step.args[2].every(value=>value==='scheduled_event')));
            if(calendar&&heads.every(head=>!head.file||(head.format??0)>=4))return this.query(compact,steps,false);
            if(selection && selection.args.every(field=>marketIndexField(fieldName(field))))
                return this.query(compact,steps,false);
            const identities=await this.query(compact,[...steps.filter(step=>step.method!=='select'),{method:'select',args:[]}],false);
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
        for (const head of files) {
            const size = head.bytes ?? 8 * 1024 * 1024;
            if (group.length && bytes + size > (this.web ? 32 : 8) * 1024 * 1024) {
                groups.push(group);
                group = [];
                bytes = 0;
            }
            group.push(head);
            bytes += size;
        }
        if (group.length)
            groups.push(group);
        const candidates: MarketRow[] = [];
        // Bound pinned disk pages: Cloud Run's writable filesystem shares its memory budget.
        for (const group of groups) {
            const rows = await this.local(group.map(head => head.file!), paths => withDuck(async (db) => {
                const compiled = compileMarketQuery(steps, group.every(head => (head.format??0) >= 2));
                const roots = [...new Set([...(query.selection ?? []), ...steps.filter(step => ['where', 'orderBy'].includes(step.method)).map(step => fieldName(step.args[0]))].map(field => field.split('.')[0]).filter(field => field !== '__name__'))];
                // A single-group projection can discard large search indexes in DuckDB,
                // before allocating JavaScript documents. Older bootstrap files still read.
                const source = group.every(head => (head.format??0) >= 2) && !roots.some(root => searchPayload.has(root)) ? 'view_payload' : 'payload';
                const payload = query.selection !== undefined ? `CASE WHEN json_type(${source})='OBJECT' THEN json_object(${roots.flatMap(root => [quote(root), `coalesce(json_extract(${source},${quote('$.' + JSON.stringify(root))}),'["undefined"]'::JSON)`]).join(',')}) ELSE ${source} END` : 'payload';
                const sql = `SELECT id,${payload},version FROM read_parquet([${paths.map(quote).join(',')}],union_by_name=true) WHERE ${compiled.where} ORDER BY ${compiled.order}${query.limit === undefined ? '' : ` LIMIT ${query.limit + query.offset}`}`;
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
        const predicates=steps.filter(step=>step.method==='where'),prefix=predicates[0];
        if(predicates.length===1&&prefix.args[1]==='array-contains'&&searchPayload.has(fieldName(prefix.args[0]))&&typeof prefix.args[2]==='string'&&steps.every(step=>['where','select','limit','offset'].includes(step.method))){
            const field=fieldName(prefix.args[0]),selected=rows.filter(row=>Array.isArray(row.data[field])&&(row.data[field] as unknown[]).includes(prefix.args[2])).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(query.offset,query.limit===undefined?undefined:query.offset+query.limit);
            return query.selection?selected.map(row=>({...row,data:project(row.data,query.selection!)})):selected;
        }
        const selected = await withDuck(async (db) => {
            await db.run('CREATE TABLE records (id VARCHAR, keys JSON, arrays JSON, position INTEGER)');
            const appender = await db.createAppender('records');
            try {
                for (let i = 0; i < rows.length; i++) {
                    const index = queryIndex(rows[i].data);
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
    async write(collection: MarketCollection, shard: string, rows: MarketRow[], retained: string[]): Promise<MarketHead> {
        if (!/^[a-z_]+$/.test(collection) || !/^[a-f0-9]{2}$/.test(shard))
            throw Error('Invalid market partition');
        if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => shardFor(row.id) !== shard))
            throw Error('Invalid market partition rows');
        const head: MarketHead = { collection, shard, rows: rows.length, retained: [...new Set(retained)].sort(), format: 5 };
        if (!rows.length)
            return head;
        const directory = await mkdtemp(join(tmpdir(), 'ya-market-')), path = join(directory, 'rows.parquet'), indexPath=join(directory,'index.parquet'),prefixPath=join(directory,'prefix.parquet');
        try {
            const prefixFields=[...searchPayload].filter(field=>rows.some(row=>Array.isArray(row.data[field])));
            const prefixRows=prefixFields.map(field=>[field,encodePrefixLookup(buildPrefixLookup(rows.map(row=>({id:row.id,values:row.data[field]}))))]);
            const payloads: string[] = [], views: string[] = [], compactPayloads:string[]=[], compactIndexes:ReturnType<typeof queryIndex>[]=[];
            for (const row of rows) {
                const fields: Data = {};
                for (const [key, value] of Object.entries(row.data))
                    fields[key] = await encodeMarket(value, this.bucket);
                payloads.push(JSON.stringify(fields));
                views.push(JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([key]) => !searchPayload.has(key)))));
                const compact=row.data.type==='scheduled_event'?row.data:project(row.data,[...MARKET_INDEX_FIELDS]), compactWire:Data={};
                for(const [key,value] of Object.entries(compact))compactWire[key]=await encodeMarket(value,this.bucket);
                compactPayloads.push(JSON.stringify(compactWire));
                compactIndexes.push(queryIndex(compact));
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
