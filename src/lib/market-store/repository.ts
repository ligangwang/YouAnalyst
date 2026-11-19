import {reportNativeRead} from './native-read-observability';
import {RetainedReadCache} from './retained-read-cache';
import {RetainedStore,relocatesCollection,type RetainedMode} from './retained-store';
import {assertReadControl} from './read-control';
import { FieldPath, FieldValue, Timestamp, type Firestore, type Transaction, type DocumentReference, type DocumentSnapshot, type Query } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { encode } from '../central-cache/codec';
import { MarketFiles, shardFor, type MarketHead, type MarketRow } from './files';
import { mergeMarketOverlay, archivedFundamentalsReceipt, fundamentalsReceiptId, receiptHasField, settledUsFundamentals, settledWorkerField, publishedFinancialField, isOperationalField, isRoutingField, splitRecord, retainsRecord, retainedWhole, retainedOnlyQuery, type MarketCollection } from './policy';
import { applyMutation, fieldName, pathParts, type Data } from './value';
import type { Step } from './query';
import {project} from './query';
import {DocumentBatcher} from './document-batcher';
import {EVENTS_CONTROL,EventsControl,eventsMode,type EventsMode} from './events-control';
import {FUNDAMENTALS_CONTROL,FundamentalsControl,fundamentalsMode,type FundamentalsMode} from './fundamentals-control';
import {compactHead,pointerCollection,pointerId,pointerHasRetained} from './head-pointer';
export const CONTROL = 'collectors/_market_parquet_control';
export const headId = (collection: MarketCollection, shard: string) => `_market_parquet_${collection}_${shard}`;
export type Mutation = {
    path: string;
    method: string;
    args: unknown[];
};
type Reader = {
    get: (query: Query | DocumentReference) => Promise<unknown>;
    getAll: (...refs: DocumentReference[]) => Promise<DocumentSnapshot[]>;
};
export type MarketContext = {
    reader: Reader;
    retainedMode?:RetainedMode;
    control?: boolean;
    fundamentals?: FundamentalsMode;
    events?: EventsMode;
    cleanupAuthorized?: boolean;
    cleanedCollections?: Set<string>;
    heads: Map<string, MarketHead>;
    documents: Map<string, DocumentSnapshot>;
    writes: Mutation[];
};
export class MarketRepository {
    private retainedStore:RetainedStore;
    private readonly bootstrapHeads=['ifindata-web','market-parquet-ui-probe'].includes(process.env.K_SERVICE??'');
    // Website deployments keep the compact pointer path without relying on an
    // operator-only environment override. Explicit 0 remains a rollback switch.
    private readonly compactHeads=process.env.MARKET_PARQUET_HEAD_POINTERS==='1'
        || this.bootstrapHeads&&process.env.MARKET_PARQUET_HEAD_POINTERS!=='0';
    private unknownRetained=new WeakSet<MarketHead>();
    private retainedSets=new WeakMap<string[],Set<string>>();
    private retainedMembership(heads:MarketHead[]){
        const byShard=new Map(heads.map(head=>[head.shard,head]));
        return {has:(id:string)=>{
            const head=byShard.get(shardFor(id));if(!head)return false;
            // Bootstrap metadata omits the large operational ID catalog. Until
            // its listener arrives, conservatively read the live document.
            if(this.unknownRetained.has(head))return true;
            const ids=head.retained;if(!ids.length)return false;
            let set=this.retainedSets.get(ids);
            if(!set){set=new Set(ids);this.retainedSets.set(ids,set);}
            return set.has(id);
        }};
    }
    private documentReads=new DocumentBatcher<MarketRow>();
    private marketCapReads=new DocumentBatcher<MarketRow>(8192);
    private fundamentals?:FundamentalsControl;
    private events?:EventsControl;
    private controls?: {
        until: number;
        value: Promise<boolean>;
    };
    private controlStop?: () => void;
    private watches = new Map<string, {
        ready: Promise<Map<string, MarketHead>>;
        heads: Map<string, MarketHead>;
        stop: () => void;
        through: Map<string,Timestamp>;
    }>();
    private results = new Map<string, {
        until: number;
        bytes: number;
        shards?: ReadonlySet<string>;
        value: Promise<MarketRow[]>;
    }>();
    private retainedReads=new RetainedReadCache();
    private listeners = new Map<string, Set<{
        shards?: Set<string>;
        change: () => void;
        error: (error: unknown) => void;
    }>>();
    private queriedPublishedGraph = false;
    private queriedThemeMembership = false;
    constructor(readonly raw: Firestore, readonly files: MarketFiles, onMode?: (ready: boolean, collection?: MarketCollection) => void, private readOnlyProbe = false, private stagedReads = false, fundamentalsGate=false, private stagedFundamentals=false, eventsGate=false, private stagedEvents=false,stagedRetained=false) {
        this.retainedStore=new RetainedStore(raw,stagedRetained,ids=>{
            const shards=new Set(ids.map(shardFor));
            this.invalidate('companies',ids.length?shards:undefined);
            this.changed('companies',ids.length?shards:new Set(Array.from({length:256},(_,n)=>n.toString(16).padStart(2,'0'))));
        });
        if(eventsGate)this.events=new EventsControl(raw,onMode?ready=>onMode(ready,'events'):undefined);
        if(fundamentalsGate)this.fundamentals=new FundamentalsControl(raw,onMode?ready=>onMode(ready,'company_fundamentals'):undefined);
        if (onMode)
            this.controlStop = raw.doc(CONTROL).onSnapshot(doc => { const data = doc.data(); try { assertReadControl(data);
                this.controls = { until: Date.now() + 10000, value: Promise.resolve(data.ready) };
                onMode(data.ready);
            }
            catch {
                this.controls = undefined; } }, () => { this.controls = undefined; });
    }
    close() { this.retainedReads.invalidate(); this.retainedStore.close(); this.events?.close(); this.fundamentals?.close(); this.controlStop?.(); for (const watch of this.watches.values())
        watch.stop(); this.watches.clear(); return this.files.close(); }
    context(reader: Reader): MarketContext { return { reader, heads: new Map(), documents: new Map(), writes: [] }; }
    invalidate(collection?: string, shards?: ReadonlySet<string>) {
        this.retainedReads.invalidate(collection,shards);
        if (!collection) { this.results.clear(); return; }
        const docsPrefix='docs:'+collection+':';
        for (const [key,entry] of this.results) {
            if (key.startsWith('query:'+collection+':')) this.results.delete(key);
            else if (key.startsWith(docsPrefix)) {
                // Cache dependencies are computed once, not hashed again on every write.
                if (!shards || !entry.shards || [...shards].some(shard=>entry.shards!.has(shard))) this.results.delete(key);
            }
        }
    }
    private changed(collection: string, shards: Set<string>) { for (const listener of this.listeners.get(collection) ?? [])
        if (!listener.shards || [...shards].some(shard => listener.shards!.has(shard)))
            listener.change(); }
    subscribe(collection: MarketCollection, ids: string[] | undefined, change: () => void, error: (error: unknown) => void) {
        const listeners = this.listeners.get(collection) ?? new Set();
        this.listeners.set(collection, listeners);
        // The first head snapshot also broadcasts shard changes. Start the
        // query once the initial inventory is ready, then forward live changes.
        let ready = false;
        const listener = { shards: ids ? new Set(ids.map(shardFor)) : undefined, change: () => {
            if (ready) change();
        }, error };
        listeners.add(listener);
        void this.heads(collection).then(() => {
            if (!listeners.has(listener)) return;
            ready = true;
            change();
        }, error);
        return () => { listeners.delete(listener); };
    }
    async committed(paths: string[]) {
        for (const collection of new Set(paths.map(path => path.split('/')[0])))
            this.invalidate(collection,new Set(paths.filter(path=>path.split('/')[0]===collection).map(path=>shardFor(path.split('/')[1]))));
        const pairs = new Map(paths.map(path => { const [collection, id] = path.split('/') as [
            MarketCollection,
            string
        ], shard = shardFor(id); return [(this.compactHeads?pointerId:headId)(collection, shard), { collection, shard }]; }));
        if (!pairs.size)
            return;
        try {
            const docs = await this.raw.getAll(...[...pairs.keys()].map(id => this.raw.collection('collectors').doc(id)));
            const changed = new Map<string, Set<string>>();
            for (const doc of docs) {
                const pair = pairs.get(doc.id)!, watch = this.watches.get(pair.collection);
                if(pair.collection==='companies'&&doc.updateTime)this.retainedStore.companiesCommitted(doc.updateTime);
                if (!watch)
                    continue;
                const head=this.parseHead(pair.collection, pair.shard, doc);
                if(this.compactHeads){if(!doc.exists)throw Error('Missing compact market head');if(pointerHasRetained(head))this.unknownRetained.add(head);}
                const prior=watch.through.get(pair.shard);
                if(prior&&(prior.seconds>doc.readTime.seconds||prior.seconds===doc.readTime.seconds&&prior.nanoseconds>doc.readTime.nanoseconds))continue;
                watch.heads.set(pair.shard, head);
                watch.through.set(pair.shard,doc.readTime);
                const shards = changed.get(pair.collection) ?? new Set<string>();
                shards.add(pair.shard);
                changed.set(pair.collection, shards);
            }
            for (const [collection, shards] of changed) {
                // Reads started while getAll was in flight may have cached the
                // preceding head. Discard those entries after installing heads.
                this.invalidate(collection,shards);this.changed(collection, shards);
            }
        }
        catch {
            for (const { collection } of pairs.values()) {
                this.watches.get(collection)?.stop();
                this.watches.delete(collection);
            }
            console.warn('Market head refresh deferred after committed write');
        }
    }
    private cached(key: string, work: () => Promise<MarketRow[]>, shards?: ReadonlySet<string>): Promise<MarketRow[]> {
        const old = this.results.get(key);
        if (old && old.until > Date.now()) {
            this.results.delete(key);
            this.results.set(key, old);
            return old.value;
        }
        const entry = { until: Infinity, bytes: 0, shards, value: work() };
        this.results.set(key, entry);
        entry.value.then(rows => { entry.until = Date.now() + 60000; entry.bytes = Buffer.byteLength(JSON.stringify(encode(rows))) * 2; let bytes = [...this.results.values()].reduce((n, e) => n + e.bytes, 0); for (const [id, value] of this.results) {
            // Keep the combined result/retained-overlay allowance at 64 MiB.
            if (bytes <= 48 * 1024 * 1024 && this.results.size <= 512)
                break;
            this.results.delete(id);
            bytes -= value.bytes;
        } }).catch(() => { if (this.results.get(key) === entry)
            this.results.delete(key); });
        return entry.value;
    }
    private async fundamentalsState(context?:MarketContext){
        if(!this.fundamentals)throw Error('Fundamentals control not configured');
        if(context)return context.fundamentals??=fundamentalsMode(await context.reader.get(this.raw.doc(FUNDAMENTALS_CONTROL)) as DocumentSnapshot);
        return this.fundamentals.read();
    }
    private async eventsState(context?:MarketContext){
        if(!this.events)throw Error('Events control not configured');
        if(context)return context.events??=eventsMode(await context.reader.get(this.raw.doc(EVENTS_CONTROL)) as DocumentSnapshot);
        return this.events.read();
    }
    async ready(context?: MarketContext,collection?:MarketCollection): Promise<boolean> {
        if(collection==='events'&&this.events){
            if(this.readOnlyProbe)return true;
            const mode=await this.eventsState(context);
            return !context&&this.stagedEvents||mode.ready;
        }
        if(collection==='company_fundamentals'&&this.fundamentals){
            if(this.readOnlyProbe)return true;
            const mode=await this.fundamentalsState(context);
            return !context&&this.stagedFundamentals||mode.ready;
        }
        // A candidate may read the verified copy before the shared cutover.
        // Transactions still consult the shared control, preserving native reads,
        // dual writes and the independent source-retirement authorization.
        if (this.readOnlyProbe)
            return true;
        const read = async () => { const doc = await (context ? context.reader.get(this.raw.doc(CONTROL)) : this.raw.doc(CONTROL).get()) as DocumentSnapshot; const data = doc.data();
            assertReadControl(data);
            if(context){context.cleanupAuthorized=data.cleanupAuthorized===true;context.cleanedCollections=new Set(Array.isArray(data.cleanedCollections)?data.cleanedCollections:[]);}
            return data.ready as boolean; };
        if (context)
            return context.control ??= await read();
        if (!this.controls || this.controls.until < Date.now()) {
            const value = read();
            this.controls = { until: Date.now() + 1000, value };
            value.then(ready => { if (ready && this.controls?.value === value)
                this.controls.until = Date.now() + 10000; }).catch(() => { this.controls = undefined; });
        }
        const ready=await this.controls.value;
        return this.stagedReads || ready;
    }
    private parseHead(collection: MarketCollection, shard: string, doc: DocumentSnapshot): MarketHead {
        if (!doc.exists)
            return { collection, shard, rows: 0, retained: [] };
        const head = doc.get('marketHead') as MarketHead;
        if (!head || head.collection !== collection || head.shard !== shard || !Array.isArray(head.retained) || !Number.isSafeInteger(head.rows))
            throw Error('Invalid market head');
        return head;
    }
    async head(collection: MarketCollection, shard: string, context?: MarketContext): Promise<MarketHead> {
        if (!context)
            return (await this.heads(collection)).get(shard) ?? { collection, shard, rows: 0, retained: [] };
        const key = collection + '/' + shard;
        if (!context.heads.has(key)) {
            const doc = await context.reader.get(this.raw.collection('collectors').doc(headId(collection, shard))) as DocumentSnapshot;
            context.heads.set(key, this.parseHead(collection, shard, doc));
        }
        return context.heads.get(key)!;
    }
    async heads(collection: MarketCollection, context?: MarketContext): Promise<Map<string, MarketHead>> {
        if (context) {
            const result = await context.reader.get(this.raw.collection('collectors').where('marketCollection', '==', collection)) as FirebaseFirestore.QuerySnapshot;
            const heads = new Map<string, MarketHead>();
            for (const doc of result.docs) {
                const shard = doc.get('marketHead.shard');
                const head = this.parseHead(collection, shard, doc);
                heads.set(shard, head);
                context.heads.set(collection + '/' + shard, head);
            }
            return heads;
        }
        let watch = this.watches.get(collection);
        if (!watch) {
            const heads = new Map<string, MarketHead>();
            let resolve!: (heads: Map<string, MarketHead>) => void, reject!: (error: unknown) => void;
            const ready = new Promise<Map<string, MarketHead>>((yes, no) => { resolve = yes; reject = no; });
            const through=new Map<string,Timestamp>();let initial=true;
            const source=this.raw.collection('collectors').where('marketCollection', '==', this.compactHeads?pointerCollection(collection):collection);
            const sameMetadata=(a:MarketHead|undefined,b:MarketHead)=>{
                if(!a)return false;
                const left={...a},right={...b};left.retained=[];right.retained=[];
                return isDeepStrictEqual(left,right);
            };
            const fail=(error:unknown)=>{this.watches.get(collection)?.stop();this.watches.delete(collection);reject(error);for(const listener of this.listeners.get(collection)??[])listener.error(error);};
            const stop = source.onSnapshot(snapshot => {try{
                if(this.compactHeads&&(snapshot.size!==256||new Set(snapshot.docs.map(doc=>doc.get('marketHead.shard'))).size!==256||snapshot.docs.some(doc=>!/^[a-f0-9]{2}$/.test(doc.get('marketHead.shard'))))){
                    throw Error('Incomplete compact market head inventory');
                }
                const changed=new Set<string>();
                const newer=(shard:string)=>{const time=through.get(shard);return time&&(time.seconds>snapshot.readTime.seconds||time.seconds===snapshot.readTime.seconds&&time.nanoseconds>snapshot.readTime.nanoseconds);};
                // A head can contain thousands of retained IDs. Firestore's
                // snapshot includes every head, but only changed documents need
                // decoding; re-expanding all arrays blocks unrelated requests.
                for (const change of snapshot.docChanges()) {
                    const doc=change.doc,shard = doc.get('marketHead.shard');
                    if(newer(shard)){
                        const prior=heads.get(shard);
                        if(!this.compactHeads&&change.type!=='removed'&&prior&&this.unknownRetained.has(prior)){
                            const head=this.parseHead(collection,shard,doc);
                            if(sameMetadata(prior,head))heads.set(shard,head);
                        }
                        continue;
                    }
                    if(change.type==='removed'){
                        if(heads.delete(shard))changed.add(shard);
                        through.set(shard,snapshot.readTime);continue;
                    }
                    const head=this.parseHead(collection,shard,doc);
                    if(this.compactHeads&&pointerHasRetained(head))this.unknownRetained.add(head);
                    const prior=heads.get(shard);
                    if(!(prior&&this.unknownRetained.has(prior)&&sameMetadata(prior,head))&&!isDeepStrictEqual(prior,head))changed.add(shard);
                    heads.set(shard,head);through.set(shard,snapshot.readTime);
                }
                // A local commit can install a head while the initial listener
                // is in flight. An initially absent head has no removed change,
                // so reconcile membership once, without decoding head payloads.
                if(initial){
                    const seen=new Set(snapshot.docs.map(doc=>doc.get('marketHead.shard')));
                    for(const shard of heads.keys())if(!seen.has(shard)&&!newer(shard)){heads.delete(shard);through.set(shard,snapshot.readTime);changed.add(shard);}
                    initial=false;
                }
                if(changed.size){this.invalidate(collection,changed);this.changed(collection,changed);}
                resolve(heads);
            }catch(error){fail(error);}},fail);
            watch = { ready, heads, stop, through };
            this.watches.set(collection, watch);
            if(this.bootstrapHeads&&!this.compactHeads){
                const fields=['collection','shard','file','bytes','rows','revision','format','indexFile','indexBytes','prefixFile','prefixBytes'];
                // A field-masked get can initialize immutable file pointers
                // without blocking small queries on every operational ID. The
                // unmasked listener remains authoritative for live changes.
                void source.select(...fields.map(field=>'marketHead.'+field)).get().then(snapshot=>{
                    if(!initial||this.watches.get(collection)?.heads!==heads)return;
                    const seen=new Set<string>(),changed=new Set<string>();
                    const newer=(shard:string)=>{const time=through.get(shard);return time&&(time.seconds>snapshot.readTime.seconds||time.seconds===snapshot.readTime.seconds&&time.nanoseconds>snapshot.readTime.nanoseconds);};
                    for(const doc of snapshot.docs){
                        const shard=doc.get('marketHead.shard');seen.add(shard);if(newer(shard))continue;
                        const value={...doc.get('marketHead'),retained:[]};
                        const head=this.parseHead(collection,shard,{exists:doc.exists,get:()=>value} as unknown as DocumentSnapshot);
                        if(!sameMetadata(heads.get(shard),head))changed.add(shard);
                        this.unknownRetained.add(head);heads.set(shard,head);through.set(shard,snapshot.readTime);
                    }
                    for(const shard of heads.keys())if(!seen.has(shard)&&!newer(shard)){heads.delete(shard);through.set(shard,snapshot.readTime);changed.add(shard);}
                    if(changed.size){this.invalidate(collection,changed);this.changed(collection,changed);}
                    resolve(heads);
                }).catch(()=>{/* The normal listener still supplies readiness or its error. */});
            }
        }
        await watch.ready;
        return new Map(watch.heads);
    }
    private async rawDocuments(refs: DocumentReference[], context?: MarketContext, fields?: string[]) {
        const load=async (batch:DocumentReference[])=>{
            const docs:DocumentSnapshot[]=[];
            for(let i=0;i<batch.length;i+=100)docs.push(...await this.retainedStore.documents(batch.slice(i,i+100),context,fields));
            return docs;
        };
        const found = new Map<string, DocumentSnapshot>();
        // Only collections with an established head watch can safely reuse
        // overlays. Transaction reads and reserved live control records bypass.
        const eligible=!context&&refs.every(ref=>{const [collection,id]=ref.path.split('/');return !id.startsWith('_')&&!id.startsWith('head_')&&this.watches.has(collection as MarketCollection);});
        {
            const docs = eligible?await this.retainedReads.read(refs,fields,load):await load(refs);
            for (const doc of docs) {
                found.set(doc.ref.path, doc);
                context?.documents.set(doc.ref.path, doc);
            }
        }
        return found;
    }
    async documents(collection: MarketCollection, ids: string[], context?: MarketContext, fields?: string[]): Promise<MarketRow[]> {
        // Current earnings revision pointers are retained whole. Read them live
        // without waiting for the immutable revision-file inventory.
        if(collection==='earnings_records'&&!fields&&ids.every(id=>id.startsWith('head_')))return this.documentsUncached(collection,ids,context,fields);
        // Live reserved records must not wait for a collection-wide file watch
        // or serve cached leases/checkpoints. Completed history still joins Parquet.
        if(collection==='company_fundamentals'&&!fields&&ids.every(id=>id.startsWith('_')))return this.documentsUncached(collection,ids,context,fields);
        if (!context) {
            await this.heads(collection);
            // Initial ID listeners reuse the preceding bulk projection. The same
            // bounded cache and head invalidation govern both access patterns.
            const remaining=new Set(ids), pending:Promise<MarketRow[]>[]=[];
            const prefix='docs:'+collection+':';
            for(const [key,entry] of this.results){
                if(!key.startsWith(prefix)||entry.until<=Date.now())continue;
                const [cachedIds,cachedFields]=JSON.parse(key.slice(prefix.length)) as [string[],string[]|null];
                if(JSON.stringify(cachedFields)!==JSON.stringify(fields??null))continue;
                if(!cachedIds.some(id=>remaining.has(id)))continue;
                pending.push(entry.value);for(const id of cachedIds)remaining.delete(id);
                if(!remaining.size){const found=new Map((await Promise.all(pending)).flat().map(row=>[row.id,row]));return ids.flatMap(id=>found.has(id)?[found.get(id)!]:[]);}
            }
            return this.cached('docs:' + collection + ':' + JSON.stringify([ids,fields]), () =>
                (collection==='company_fundamentals'&&fields?.length===2&&fields.includes('marketCap')&&fields.includes('isDeleted')?this.marketCapReads:this.documentReads).load(JSON.stringify([collection,fields??null]),ids,
                    batch=>this.documentsUncached(collection,batch,undefined,fields)),new Set(ids.map(shardFor)));
        }
        return this.documentsUncached(collection, ids, context, fields);
    }
    private async documentsUncached(collection: MarketCollection, ids: string[], context?: MarketContext, fields?: string[]): Promise<MarketRow[]> {
        await this.ready(context,collection);
        if(collection==='company_fundamentals' && fields?.length && fields.every(publishedFinancialField) && ids.every(id=>!id.startsWith('_'))){
            const shards=[...new Set(ids.map(shardFor))];
            const heads=await Promise.all(shards.map(shard=>this.head(collection,shard,context)));
            const rows=await this.files.query(heads,[
                {method:'where',args:[FieldPath.documentId(),'in',ids]},
                {method:'select',args:fields},
            ]);
            return Promise.all(rows.map(row=>this.files.hydrate(row)));
        }
        if (collection === 'company_fundamentals' && ids.length && ids.every(fundamentalsReceiptId)) {
            const heads = await Promise.all([...new Set(ids.map(shardFor))].map(shard => this.head(collection, shard, context)));
            const byShard = new Map(heads.map(head => [head.shard, head]));
            const candidates = ids.filter(id => {
                const head = byShard.get(shardFor(id))!;
                return head.file && !head.retained.includes(id);
            });
            if (candidates.length) {
                const stored = await this.files.query(heads, [{method: 'where', args: [FieldPath.documentId(), 'in', candidates]}]);
                const archived = new Map<string, MarketRow>();
                for (const row of stored) {
                    if (row.data.completed !== true) continue;
                    const full = await this.files.hydrate(row);
                    if (archivedFundamentalsReceipt(full.id, full.data))
                        archived.set(full.id, fields ? {...full, data: project(full.data, fields)} : full);
                }
                if (archived.size) {
                    const remaining = ids.filter(id => !archived.has(id));
                    if (remaining.length) for (const row of await this.documentsWithRetained(collection, remaining, context, fields))
                        archived.set(row.id, row);
                    return ids.flatMap(id => archived.has(id) ? [archived.get(id)!] : []);
                }
            }
        }
        return this.documentsWithRetained(collection, ids, context, fields);
    }
    private async documentsWithRetained(collection: MarketCollection, ids: string[], context?: MarketContext, fields?: string[]): Promise<MarketRow[]> {
        const earningsHeads=collection==='earnings_records'&&!fields&&ids.every(id=>id.startsWith('head_'));
        const reserved=earningsHeads||collection==='company_fundamentals'&&!fields&&ids.every(id=>id.startsWith('_'))?await this.rawDocuments(ids.map(id=>this.raw.collection(collection).doc(id)),context):undefined;
        if(reserved&&[...reserved.values()].every(doc=>doc.exists&&(earningsHeads?doc.get('recordType')==='head':doc.get('completed')!==true)))return ids.map(id=>{const doc=reserved.get(collection+'/'+id)!;return {id,data:doc.data()!,version:doc.updateTime!};});
        const heads = await Promise.all([...new Set(ids.map(shardFor))].map(shard => this.head(collection, shard, context)));
        const retained = this.retainedMembership(heads);
        // Full company reads already require these live records. A complete
        // editorial company has no external payload. Require its external status
        // field as positive evidence of a whole record: a stripped operational
        // overlay lacks status and must still merge its Parquet row. Never apply
        // the whole-record predicate to incomplete overlays in other collections.
        const native = reserved ?? (!fields && (collection === 'companies' || collection === 'company_fundamentals') ? await this.rawDocuments(ids.filter(id => retained.has(id)).map(id => this.raw.collection(collection).doc(id)), context) : undefined);
        const whole = new Set([...native?.values() ?? []].filter(doc => doc.exists && (collection==='companies' ? typeof doc.get('status') === 'string' && retainedWhole(collection,doc.id,doc.data()!) : doc.id.startsWith('_') && doc.get('completed')!==true)).map(doc => doc.id));
        const externalIds = ids.filter(id => !whole.has(id));
        const result = new Map((externalIds.length ? await this.files.query(heads, [{ method: 'where', args: [FieldPath.documentId(), 'in', externalIds] }, ...(fields ? [{method:'select',args:fields}] : [])]) : []).map(row => [row.id, row]));
        // An external-only projection needs no live-state document read. Whole
        // authored records still come from Firestore when no external row exists.
        const refs = ids.filter(id => retained.has(id) && (!fields || !result.has(id) || fields.some(field => isOperationalField(collection,field) || isRoutingField(field)))).map(id => this.raw.collection(collection).doc(id));
        for (const doc of (native ?? await this.rawDocuments(refs, context, fields)).values())
            if (doc.exists) {
                const previous = result.get(doc.id), overlay = previous ? splitRecord(collection, doc.id, doc.data()!, true).retained : doc.data();
                if(previous&&!Object.keys(overlay??{}).length)continue;
                result.set(doc.id, { id: doc.id, data: mergeMarketOverlay(collection, previous?.data, overlay), version: doc.updateTime ?? previous?.version ?? Timestamp.now() });
            }
        const selected: MarketRow[] = [];
        for (const id of ids)
            if (result.has(id))
                selected.push(await this.files.hydrate(result.get(id)!));
        return selected;
    }
    private nativeQuerySteps(collection: MarketCollection, steps: Step[], operational: boolean):Step[] {
        const native:Step[]=[];
        const bounds = steps.filter(s => ['startAt', 'startAfter', 'endAt', 'endBefore'].includes(s.method));
        const order = steps.filter(s => s.method === 'orderBy');
        const bounded = !operational || steps.filter(s => ['where', 'orderBy'].includes(s.method)).every(s => fieldName(s.args[0]) === '__name__' || isOperationalField(collection, fieldName(s.args[0])) || isRoutingField(fieldName(s.args[0])));
        for (const step of steps) {
            const [field, op, value] = step.args;
            if (step.method === 'where' && (!operational || fieldName(field) === '__name__' || isOperationalField(collection, fieldName(field)) || isRoutingField(fieldName(field))))
                native.push({method:'where',args:[field,op,value]});
            if (bounded && step.method === 'orderBy')
                native.push({method:'orderBy',args:step.args});
        }
        if (bounded) {
            for (const step of bounds) {
                const first = step.args[0] as {
                    get?: (name: unknown) => unknown;
                    id?: string;
                };
                let values = step.args;
                if (first?.get) {
                    if (!order.some(o => fieldName(o.args[0]) === '__name__'))
                        native.push({method:'orderBy',args:[FieldPath.documentId(),order.at(-1)?.args[1]]});
                    const ordering = [...order, ...(order.some(o => fieldName(o.args[0]) === '__name__') ? [] : [{ method: 'orderBy', args: [FieldPath.documentId()] }])];
                    values = ordering.map(o => fieldName(o.args[0]) === '__name__' ? first.id : first.get!(o.args[0]));
                }
                native.push({method:step.method,args:values});
            }
            const limit = steps.find(s => s.method === 'limit' || s.method === 'limitToLast');
            const offset = Number(steps.find(s => s.method === 'offset')?.args[0] ?? 0);
            if (limit)
                native.push({method:limit.method,args:[Number(limit.args[0])+offset]});
        }
        const selection = steps.find(step => step.method === 'select');
        if (selection) {
            const fields = [...new Set([...selection.args.map(fieldName), ...steps.filter(step => ['where', 'orderBy'].includes(step.method)).map(step => fieldName(step.args[0]))])].filter(field => field !== '__name__');
            native.push({method:'select',args:fields});
        }
        return native;
    }
    private nativeQuery(collection: MarketCollection, steps: Step[], operational: boolean, path:string=collection) {
        let query:Query=this.raw.collection(path);
        for(const step of this.nativeQuerySteps(collection,steps,operational))
            query=(query[step.method as 'where'] as (...args:unknown[])=>Query).apply(query,step.args);
        return query;
    }
    async query(collection: MarketCollection, steps: Step[], context?: MarketContext): Promise<MarketRow[]> {
        const predicate=steps.filter(step=>step.method==='where'), selection=steps.find(step=>step.method==='select');
        if(predicate.length===1&&steps.every(step=>step.method==='where'||step.method==='select')&&fieldName(predicate[0].args[0])==='__name__'){
            const [,op,value]=predicate[0].args;
            const ids=op==='=='&&typeof value==='string'?[value]:op==='in'&&Array.isArray(value)&&value.length&&value.every(id=>typeof id==='string')?value as string[]:undefined;
            if(ids){const rows=await this.documents(collection,[...new Set(ids)],context,selection?.args.map(fieldName));return rows.sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));}
        }
        if (!context) {
            await this.heads(collection);
            const normalized = steps.map(step => ({ method: step.method, args: step.args.map(value => value instanceof FieldPath ? { field: fieldName(value) } : value && typeof value === 'object' && 'ref' in value ? { cursor: (value as DocumentSnapshot).ref.path, version: encode((value as DocumentSnapshot).updateTime) } : encode(value)) }));
            const key = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
            return this.cached('query:' + collection + ':' + key, () => this.queryUncached(collection, steps));
        }
        return this.queryUncached(collection, steps, context);
    }
    private async queryUncached(collection: MarketCollection, steps: Step[], context?: MarketContext): Promise<MarketRow[]> {
        const heads = [...(await this.heads(collection, context)).values()];
        if (!context && collection === 'companies' && this.files.directoryCandidates) {
            const ids = await this.files.directoryCandidates(heads, steps);
            if (ids && (await this.retainedStore.mode()).ready) {
                if (!ids.length) return [];
                const fields = steps.find(step => step.method === 'select')!.args.map(fieldName);
                const rows = await this.documents(collection, ids, undefined, fields);
                const byId = new Map(rows.map(row => [row.id, row]));
                return ids.flatMap(id => byId.get(id) ?? []);
            }
        }
        const operational = steps.some(s => ['where', 'orderBy'].includes(s.method) && isOperationalField(collection, fieldName(s.args[0])));
        const retainedIds = this.retainedMembership(heads);
        const candidateSteps = steps.filter(s => !['offset', 'select', 'count'].includes(s.method)).map(s => s.method === 'limit' || s.method === 'limitToLast' ? { ...s, args: [Number(s.args[0]) + Number(steps.find(s => s.method === 'offset')?.args[0] ?? 0)] } : s);
        const projection = steps.find(step => step.method === 'select');
        if (projection)
            candidateSteps.push({ method: 'select', args: [...new Set([...projection.args.map(fieldName), ...steps.filter(step => ['where', 'orderBy'].includes(step.method)).map(step => fieldName(step.args[0]))])].filter(field => field !== '__name__') });
        const onlyRetained = retainedOnlyQuery(collection, steps);
        // These fields exist only in the transactional overlay. Native matches
        // identify every candidate; scanning Parquet for an absent field adds
        // a full collection read without finding any additional records.
        // updatedAt is special: external-only records keep it in Parquet.
        const receiptCandidates = collection === 'company_fundamentals'
            && steps.filter(step => ['where', 'orderBy'].includes(step.method)).every(step =>
                receiptHasField(fieldName(step.args[0]))
                && !(step.method === 'where' && fieldName(step.args[0]) === 'manualRequired' && step.args[1] === '==' && step.args[2] === true));
        const requiresOverlay = !receiptCandidates && steps.some(step => ['where', 'orderBy'].includes(step.method)
            && fieldName(step.args[0]).split('.')[0] !== 'updatedAt'
            && !(collection === 'company_fundamentals' && publishedFinancialField(fieldName(step.args[0])))
            && !(collection === 'company_fundamentals' && settledWorkerField(fieldName(step.args[0]),
                step.method === 'where' ? step.args[1] : undefined, step.args[2]))
            && isOperationalField(collection, fieldName(step.args[0])));
        const externalCandidates = (): Promise<MarketRow[]> => onlyRetained || requiresOverlay
            ? Promise.resolve([]) : this.files.query(heads, candidateSteps);
        const searchFields = ['searchPrefixes', 'symbolLower'];
        const directoryLookup = collection === 'companies' && !context && projection
            && steps.some(step => step.method === 'limit' && Number(step.args[0]) <= 50)
            && steps.some(step => step.method === 'where' && searchFields.includes(fieldName(step.args[0])));
        // Search reads the same immutable Parquet heads whichever retained snapshot arrives.
        // Start both loads together on a miss so a new instance pays the longer wait only once.
        // A capped directory search can query each retained root directly on a cold
        // instance. Reuse a warm view, but reserve full listener bootstrap for broad reads.
        const boundedSearch = directoryLookup && this.nativeQuerySteps(collection, steps, operational)
            .some(step => step.method === 'limit' && Number(step.args[0]) <= 50);
        // A cold graph subscription needs only published issuers. If it refreshes
        // repeatedly, allow the shared view to amortize subsequent invalidations.
        const firstGraphRead = !context && !this.queriedPublishedGraph && collection === 'companies'
            && onlyRetained && !!projection && steps.some(step => step.method === 'where'
                && step.args[0] === 'inGraph.status' && step.args[1] === '==' && step.args[2] === 'PUBLISHED');
        // The theme subscription can follow the graph subscription on the same
        // cold instance. Its first lookup already has an indexed array predicate.
        const firstThemeRead = !context && !this.queriedThemeMembership && collection === 'companies'
            && !!projection && this.nativeQuerySteps(collection, steps, operational).some(step => step.method === 'where'
                && step.args[0] === 'themeIds' && step.args[1] === 'array-contains');
        if (firstThemeRead) this.queriedThemeMembership = true;
        if (firstGraphRead) this.queriedPublishedGraph = true;
        const [companyView, earlyCandidates] = await Promise.all([
            collection === 'companies' ? this.retainedStore.companies(context, !boundedSearch && !firstGraphRead && !firstThemeRead) : undefined,
            directoryLookup ? externalCandidates() : undefined,
        ]);
        // Selecting candidates only needs predicate/order fields. Decoding all
        // company profiles here would replace read amplification with CPU work.
        const viewSteps=companyView?this.nativeQuerySteps(collection,steps,operational).filter(step=>step.method!=='select'):[];
        const viewFields=[...new Set(viewSteps.filter(step=>['where','orderBy'].includes(step.method)).map(step=>fieldName(step.args[0]).split('.')[0]))].filter(field=>field!=='__name__');
        const viewRows=companyView?await this.files.filter([...companyView.values()].map(doc=>({id:doc.id,
            data:Object.fromEntries(viewFields.map(field=>[field,doc.get(field)]).filter(([,value])=>value!==undefined)),version:doc.updateTime!})),viewSteps):undefined;
        const rawPage = {docs:viewRows?viewRows.map(row=>companyView!.get(row.id)!):heads.some(head=>head.retained.length||this.unknownRetained.has(head))
            ?await this.retainedStore.query(collection,path=>this.nativeQuery(collection,steps,operational,path),context):[]};
        if(!companyView)reportNativeRead(collection,steps,rawPage.docs.length,!!context,rawPage.docs);
        if (!steps.some(s => s.method === 'select'))
            for (const doc of rawPage.docs)
                context?.documents.set(doc.ref.path, doc);
        const external = earlyCandidates ?? await externalCandidates(), result = new Map(external.map(row => [row.id, row]));
        const raw = new Map<string, DocumentSnapshot>(rawPage.docs.filter(doc => retainedIds.has(doc.id)).map(doc => [doc.id, doc]));
        // An unbounded identity-ordered scan already returned every external
        // row. Missing IDs are retained-only records, so a second Parquet scan
        // cannot add payloads (and is expensive for the company directory).
        const completeExternalScan = !onlyRetained && !requiresOverlay && candidateSteps.every(step =>
            step.method === 'select' || step.method === 'orderBy' && fieldName(step.args[0]) === '__name__');
        const missingExternal = completeExternalScan ? [] : rawPage.docs.filter(doc => !result.has(doc.id)).map(doc => doc.id);
        if (missingExternal.length && !onlyRetained) {
            const selected = heads.filter(head => missingExternal.some(id => shardFor(id) === head.shard));
            for (const row of await this.files.query(selected, [{ method: 'where', args: [FieldPath.documentId(), 'in', missingExternal] }, ...candidateSteps.filter(step => step.method === 'select')]))
                result.set(row.id, row);
        }
        // A projection containing only external fields needs no transactional
        // overlay. Retained-only (including authored) records still come from
        // rawPage; operational predicates/projections retain their live reads.
        const externalProjection = !operational && projection && projection.args.every(field => !isOperationalField(collection, fieldName(field)));
        const needed = externalProjection ? [] : external.filter(row => retainedIds.has(row.id) && !raw.has(row.id)).map(row => this.raw.collection(collection).doc(row.id));
        for (const doc of (await this.rawDocuments(needed, context)).values())
            raw.set(doc.id, doc);
        for (const doc of raw.values())
            if (doc.exists) {
                const fields=companyView&&projection?this.nativeQuerySteps(collection,steps,operational).find(step=>step.method==='select')?.args.map(fieldName):undefined;
                const data=fields?project(Object.fromEntries([...new Set(fields.map(field=>field.split('.')[0]))].map(field=>[field,doc.get(field)])),fields):doc.data()!;
                const prior = result.get(doc.id), overlay = prior ? splitRecord(collection, doc.id, data, true).retained : data;
                if(prior&&!Object.keys(overlay??{}).length)continue;
                result.set(doc.id, { id: doc.id, data: mergeMarketOverlay(collection, prior?.data, overlay), version: doc.updateTime ?? prior?.version ?? Timestamp.now() });
            }
        const selected = await this.files.filter([...result.values()], steps), hydrated: MarketRow[] = [];
        for (const row of selected)
            hydrated.push(await this.files.hydrate(row));
        return hydrated;
    }
    /** Recalculate against the latest published row on every transaction retry. */
    async updatePublishedMarketCap(id: string, calculate: (published: Data) => Data) {
        return this.updatePublishedFinancialField(id, 'marketCap', calculate);
    }
    async updatePublishedFinancialField(id: string, field: 'marketCap' | 'cnAnnual', calculate: (published: Data) => Data) {
        if (this.readOnlyProbe || !id || id.startsWith('_') || id.includes('/'))
            throw Error('Expected a writable company financial record');
        const collection = 'company_fundamentals';
        const shard = shardFor(id);
        await this.raw.runTransaction(async tx => {
            const mode = fundamentalsMode(await tx.get(this.raw.doc(FUNDAMENTALS_CONTROL)));
            if (!mode.ready || !mode.cleanupAuthorized || !mode.cleanedCollections.has(collection))
                throw Error('Financial source retirement is incomplete');
            const context = this.context({get: ref => tx.get(ref as DocumentReference), getAll: (...refs) => tx.getAll(...refs)});
            const head = await this.head(collection, shard, context);
            const rows = await this.files.read(head);
            const index = rows.findIndex(row => row.id === id);
            const data = index < 0 ? {} : (await this.files.hydrate(rows[index])).data;
            const version = Timestamp.now();
            const value = calculate(data);
            const updated = applyMutation(data, 'set', [{[field]: value}, {merge: true}], version)!;
            const row = {id, data: updated, version};
            if (index < 0) rows.push(row);
            else rows[index] = row;
            const next = await this.files.write(collection, shard, rows, head.retained);
            next.revision = randomUUID();
            const catalog = this.raw.collection('collectors');
            tx.set(catalog.doc(headId(collection, shard)), {marketCollection: collection, marketHead: next});
            tx.set(catalog.doc(pointerId(collection, shard)), {marketCollection: pointerCollection(collection), marketHead: compactHead(next)});
        });
        await this.committed([`${collection}/${id}`]);
    }
    /** Prepare immutable objects first; their heads and all operational/UGC writes
     * are published by the caller's single Firestore transaction commit. */
    async prepare(context: MarketContext, tx: Transaction, mutations: Mutation[]) {
        if (this.readOnlyProbe)
            throw Error('Read-only market probe cannot mutate production');
        // Independently staged collections use their own transactional gates;
        // unrelated global reads add latency to lease/checkpoint transactions.
        const independentlyGated=mutations.every(write=>this.fundamentals&&write.path.startsWith('company_fundamentals/')||this.events&&write.path.startsWith('events/'));
        const ready = independentlyGated ? false : await this.ready(context), groups = new Map<string, {
            collection: MarketCollection;
            shard: string;
            writes: Mutation[];
        }>();
        // Read cutover and source retirement are separate gates. Keep complete
        // source mirrors until production UI verification authorizes cleanup.
        if(this.fundamentals&&mutations.some(write=>write.path.startsWith('company_fundamentals/')))await this.fundamentalsState(context);
        if(this.events&&mutations.some(write=>write.path.startsWith('events/')))await this.eventsState(context);
        const modeFor=(collection:string)=>collection==='events'&&this.events?context.events!:collection==='company_fundamentals'&&this.fundamentals?context.fundamentals!:{ready,cleanupAuthorized:context.cleanupAuthorized===true,cleanedCollections:context.cleanedCollections};
        const retires=(collection:string)=>{const mode=modeFor(collection);return mode.ready&&mode.cleanupAuthorized;};
        const relocated=mutations.some(write=>relocatesCollection(write.path.split('/')[0]))
            ?await this.retainedStore.mode(context):{enabled:false,ready:false,cleanupAuthorized:false};
        if(relocated.enabled&&mutations.some(write=>{const collection=write.path.split('/')[0];return relocatesCollection(collection)&&!retires(collection);}))
            throw Error('Retained-state relocation requires completed external-payload retirement');
        for (const write of mutations) {
            const [collection, id] = write.path.split('/') as [
                MarketCollection,
                string
            ], shard = shardFor(id), key = collection + '/' + shard;
            const group = groups.get(key) ?? { collection, shard, writes: [] };
            group.writes.push(write);
            groups.set(key, group);
        }
        const writes: Array<() => void> = [];
        const missingHeads = [...groups.values()].filter(group => !context.heads.has(group.collection + '/' + group.shard));
        for (let offset = 0; offset < missingHeads.length; offset += 100) {
            const batch = missingHeads.slice(offset, offset + 100), docs = await context.reader.getAll(...batch.map(group => this.raw.collection('collectors').doc(headId(group.collection, group.shard))));
            for (let n = 0; n < batch.length; n++) {
                const group = batch[n];
                context.heads.set(group.collection + '/' + group.shard, this.parseHead(group.collection, group.shard, docs[n]));
            }
        }
        const sourcePaths = [...new Set(mutations.map(write => write.path))].filter(path => { const [collection, id] = path.split('/'); return !context.documents.has(path) && (!retires(collection) || !modeFor(collection).cleanedCollections?.has(collection) || context.heads.get(collection + '/' + shardFor(id))!.retained.includes(id)); });
        await this.rawDocuments(sourcePaths.map(path => this.raw.doc(path)), context);
        const queued = [...groups.values()];
        let nextGroup = 0;
        await Promise.all(Array.from({ length: Math.min(8, queued.length) }, async () => {
            for (;;) {
                const index = nextGroup++;
                if (index >= queued.length)
                    return;
                const { collection, shard, writes: changes } = queued[index];
                const {ready,cleanedCollections}=modeFor(collection),retire=retires(collection);
                const head = await this.head(collection, shard, context), retained = new Set(head.retained);
                const paths = [...new Set(changes.map(change => change.path))].filter(path => !context.documents.has(path));
                for (const path of paths)
                    if (retire && cleanedCollections?.has(collection) && !retained.has(path.split('/')[1]))
                        context.documents.set(path, { exists: false, id: path.split('/')[1], ref: this.raw.doc(path), data: () => undefined } as DocumentSnapshot);
                const refs = paths.filter(path => !context.documents.has(path)).map(path => this.raw.doc(path));
                await this.rawDocuments(refs, context);
                const at = Timestamp.now();
                // Live reserved fundamentals records are wholly operational. They
                // already reside in Firestore, so a lease/checkpoint update does
                // not need to decode an unrelated Parquet shard. A transition to
                // a completed historical record still takes the archival path.
                const live = new Map<string, Data | undefined>();
                let retainedOnly=ready&&collection==='company_fundamentals';
                for(const change of changes){
                    if(!retainedOnly)break;
                    const id=change.path.split('/')[1],doc=context.documents.get(change.path)!;
                    if(!id.startsWith('_')||!doc.exists||!retained.has(id)||doc.get('completed')===true){retainedOnly=false;break;}
                    const value=applyMutation(live.has(id)?live.get(id):doc.data(),change.method,change.args,at);
                    live.set(id,value);
                }
                if([...live.values()].some(value=>value?.completed===true))retainedOnly=false;
                const previous=retainedOnly?[]:await this.files.read(head),rows=new Map(previous.map(row=>[row.id,row]));
                const complete = new Map<string, Data | undefined>();
                for (const change of changes) {
                    const id = change.path.split('/')[1], doc = context.documents.get(change.path)!;
                    const overlay = doc.exists && retained.has(id) ? rows.has(id) ? splitRecord(collection, id, doc.data()!, true).retained : doc.data() : undefined;
                    const stored = rows.get(id), base = stored ? (await this.files.hydrate(stored)).data : undefined;
                    const before = complete.has(id) ? complete.get(id) : ready ? (rows.has(id) || overlay ? mergeMarketOverlay(collection, base, overlay) : undefined) : doc.data();
                    const options = change.args.at(-1) as {
                        lastUpdateTime?: Timestamp;
                    } | undefined;
                    if (options?.lastUpdateTime) {
                        let matches=doc.updateTime?.isEqual(options.lastUpdateTime);
                        if(!matches&&!retained.has(id)&&(ready||(collection==='events'&&this.events?this.stagedEvents:collection==='company_fundamentals'&&this.fundamentals?this.stagedFundamentals:this.stagedReads))&&stored?.version.isEqual(options.lastUpdateTime)){
                            // Staged snapshots expose the Parquet version. Before
                            // cutover, accept it only while the native source is
                            // still the same mirrored data, under this transaction.
                            matches=ready||(doc.exists&&isDeepStrictEqual(splitRecord(collection,id,doc.data()!).external,base));
                        }
                        if(!matches)throw Object.assign(Error('Market document precondition failed'), {code:9});
                    }
                    complete.set(id, applyMutation(before, change.method, change.args, at));
                }
                for (const [id, data] of complete) {
                    const ref = this.raw.collection(collection).doc(id);
                    if (!data) {
                        rows.delete(id);
                        const hadRetained = retained.delete(id);
                        if (!retire || hadRetained || context.documents.get(ref.path)?.exists)
                            writes.push(() => this.retainedStore.write(tx,relocated,collection,id,undefined));
                        continue;
                    }
                    const published = rows.get(id);
                    // After cutover, completing live work must also retire its queue entry.
                    // Before cutover, keep the previous placement of already archived rows.
                    const canArchive = retire && ready && relocated.cleanupAuthorized && cleanedCollections?.has(collection);
                    const alreadyArchived = !retained.has(id) && published?.data.pending === false;
                    const archive = collection === 'company_fundamentals' && (canArchive || alreadyArchived)
                        && settledUsFundamentals(id, data, at.toMillis());
                    const split = archive ? {external:data, retained:{}} : splitRecord(collection, id, data);
                    const keep=retainsRecord(collection,id,data,split.retained);
                    if (Object.keys(split.external).length || !keep) {
                        if (!isDeepStrictEqual(rows.get(id)?.data, split.external))
                            rows.set(id, { id, data: split.external, version: at });
                    }
                    else
                        rows.delete(id);
                    if (keep)
                        retained.add(id);
                    else
                        retained.delete(id);
                    // Keep operational server timestamps equal to the transaction's other
                    // Firestore markers, including the feed revision's closed delta boundary.
                    const stampPaths = new Set<string>();
                    const scan = (value: unknown, path: string[]) => { if (value instanceof FieldValue && value.isEqual(FieldValue.serverTimestamp()))
                        stampPaths.add(path.join('.'));
                    else if (value && Object.getPrototypeOf(value) === Object.prototype)
                        for (const [k, v] of Object.entries(value))
                            scan(v, [...path, k]); };
                    for (const change of changes.filter(change => change.path === ref.path)) {
                        if (change.method === 'update' && (typeof change.args[0] === 'string' || change.args[0] instanceof FieldPath)) {
                            for (let n = 0; n + 1 < change.args.length; n += 2)
                                scan(change.args[n + 1], pathParts(change.args[n]));
                        }
                        else
                            scan(change.args[0], []);
                    }
                    const serverStamps = (value: Data, path: string[] = []): Data => Object.fromEntries(Object.entries(value).map(([key, item]) => { const next = [...path, key]; return [key, item instanceof Timestamp && item.isEqual(at) && stampPaths.has(next.join('.')) ? FieldValue.serverTimestamp() : item && Object.getPrototypeOf(item) === Object.prototype ? serverStamps(item as Data, next) : item]; }));
                    if (!retire)
                        writes.push(() => this.retainedStore.write(tx,relocated,collection,id,{ ...split.external, ...serverStamps(split.retained) }));
                    else if (keep)
                        writes.push(() => this.retainedStore.write(tx,relocated,collection,id,serverStamps(split.retained)));
                    else if (context.documents.get(ref.path)?.exists)
                        writes.push(() => this.retainedStore.write(tx,relocated,collection,id,undefined));
                }
                const nextRows = [...rows.values()];
                const changed = !isDeepStrictEqual(previous, nextRows);
                // The small head revision also delivers retained-only changes to existing
                // entity caches, without listening to entire external-data collections.
                const next = changed ? await this.files.write(collection, shard, nextRows, [...retained]) : { ...head, retained: [...retained].sort() };
                next.revision = randomUUID();
                writes.push(() => tx.set(this.raw.collection('collectors').doc(headId(collection, shard)), { marketCollection: collection, marketHead: next }));
                const pointer=compactHead(next);
                writes.push(() => tx.set(this.raw.collection('collectors').doc(pointerId(collection,shard)),{marketCollection:pointerCollection(collection),marketHead:pointer}));
            }
        }));
        return () => { for (const write of writes)
            write(); };
    }
}
