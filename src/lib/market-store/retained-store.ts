import type {Firestore,DocumentReference,DocumentSnapshot,Query,Transaction,Timestamp} from 'firebase-admin/firestore';
import {isMarketCollection,type MarketCollection,hasAuthoredContent} from './policy';
import {getField,type Data} from './value';
import {project} from './query';
import {reportNativeBatchRead} from './native-read-observability';
import {CompanyView,companyViewEnabled} from './company-view';

export const RETAINED_CONTROL='collectors/_market_parquet_retained_control';
export type RetainedMode={enabled:boolean;ready:boolean;cleanupAuthorized:boolean};
type Reader={get:(ref:Query|DocumentReference)=>Promise<unknown>;getAll:(...refs:DocumentReference[])=>Promise<DocumentSnapshot[]>};
export type RetainedContext={reader:Reader;retainedMode?:RetainedMode};
export const relocatesCollection=(name:string):name is MarketCollection=>isMarketCollection(name)&&name!=='events'&&name!=='prediction_daily_marks';
export function retainedRoot(collection:MarketCollection,id:string,data:Data):'market_state'|'market_ugc'{
    // Preserve entire curated records, including their existing live fields.
    return hasAuthoredContent(data)
        ||collection==='companies'&&!id.startsWith('_')&&(typeof data.status==='string'&&data.status!=='DIRECTORY'||!!data.themeMemberships||!!data.inGraph)
        ||collection==='company_relationships'&&!['NEWS_OBSERVATION','FILING_OBSERVATION'].includes(String(data.recordKind))
        ?'market_ugc':'market_state';
}
export const retainedPath=(root:'market_state'|'market_ugc',collection:string,id:string)=>`${root}/${collection}/records/${id}`;
export function retainedMode(doc:DocumentSnapshot):RetainedMode{
    if(!doc.exists)return {enabled:false,ready:false,cleanupAuthorized:false};
    const data=doc.data();
    if(data?.version!==1||typeof data.ready!=='boolean'||typeof data.cleanupAuthorized!=='boolean'
        ||data.cleanupAuthorized&&!data.ready)throw Error('Invalid retained-state migration control');
    return {enabled:true,ready:data.ready,cleanupAuthorized:data.cleanupAuthorized};
}
/** Physical retained-record locations stay behind stable logical document IDs. */
export class RetainedStore {
    private companyView?:CompanyView;
    private logicalCompanies?:{source:Map<string,DocumentSnapshot>;docs:Map<string,DocumentSnapshot>};
    private cached?:{until:number;value:Promise<RetainedMode>};
    private locations=new Map<string,'market_state'|'market_ugc'>();
    private remember(path:string,root:'market_state'|'market_ugc'){
        // Bound routing hints independently of payload caches. An absent hinted
        // record always falls back to both destinations, so moves stay visible.
        if(Buffer.byteLength(path)>256)return;
        this.locations.delete(path);this.locations.set(path,root);
        while(this.locations.size>1024)this.locations.delete(this.locations.keys().next().value!);
    }
    constructor(private raw:Firestore,private stagedReads=false,onCompaniesChanged?:(ids:string[])=>void){
        if(onCompaniesChanged&&companyViewEnabled())this.companyView=new CompanyView(raw,onCompaniesChanged);
    }
    closeCompanyView(){this.companyView?.close();this.companyView=undefined;this.logicalCompanies=undefined;}
    close(){this.closeCompanyView();}
    companiesCommitted(at:Timestamp){this.companyView?.afterCommit(at);}
    async companies(context?:RetainedContext,start=false){
        if(context||!this.companyView||!this.readsNew(await this.mode()))return undefined;
        const docs=await this.companyView.read(start);
        if(!docs){this.logicalCompanies=undefined;return undefined;}
        if(this.logicalCompanies?.source!==docs)this.logicalCompanies={source:docs,docs:new Map([...docs].map(([id,doc])=>[id,this.logical(doc,this.raw.collection('companies').doc(id))]))};
        return this.logicalCompanies.docs;
    }
    private readsNew(mode:RetainedMode|undefined,context?:RetainedContext){return mode?.ready||!!mode?.enabled&&!context&&this.stagedReads;}
    async mode(context?:RetainedContext):Promise<RetainedMode>{
        if(context)return context.retainedMode??=retainedMode(await context.reader.get(this.raw.doc(RETAINED_CONTROL)) as DocumentSnapshot);
        if(!this.cached||this.cached.until<Date.now()){
            const entry={until:Date.now()+1000,value:this.raw.doc(RETAINED_CONTROL).get().then(retainedMode)};
            this.cached=entry;entry.value.catch(()=>{if(this.cached===entry)this.cached=undefined;});
        }
        return this.cached.value;
    }
    private logical(doc:DocumentSnapshot,ref:DocumentReference):DocumentSnapshot{
        return new Proxy(doc,{get(target,key){if(key==='ref')return ref;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    }
    private projected(doc:DocumentSnapshot,fields?:string[]):DocumentSnapshot{
        if(!fields)return doc;
        const roots=[...new Set(fields.filter(field=>field!=='__name__').map(field=>field.split('.')[0]))];
        const data=()=>project(Object.fromEntries(roots.map(field=>[field,doc.get(field)])),fields);
        return new Proxy(doc,{get(target,key){
            if(key==='data')return data;
            if(key==='get')return (field:string)=>getField(data(),field);
            const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
        }});
    }
    async documents(refs:DocumentReference[],context?:RetainedContext,fields?:string[]):Promise<DocumentSnapshot[]>{
        // A warmed website view serves whole documents; callers still apply
        // their projection. Transactions and workers always use native reads.
        if(!context&&this.companyView&&refs.length&&refs.every(ref=>ref.path.split('/')[0]==='companies')){
            const companies=await this.companies();
            if(companies&&refs.every(ref=>companies.has(ref.id)))return refs.map(ref=>this.projected(companies.get(ref.id)!,fields));
            if(companies&&refs.some(ref=>companies.has(ref.id))){
                const missing=await this.documents(refs.filter(ref=>!companies.has(ref.id)),context,fields);
                const found=new Map(missing.map(doc=>[doc.id,doc]));
                return refs.map(ref=>companies.has(ref.id)?this.projected(companies.get(ref.id)!,fields):found.get(ref.id)!);
            }
        }
        const relocate=refs.some(ref=>relocatesCollection(ref.path.split('/')[0]));
        const mode=relocate?await this.mode(context):undefined;
        const roots=refs.map(ref=>this.readsNew(mode,context)&&relocatesCollection(ref.path.split('/')[0])
            ?this.locations.get(ref.path)??(['companies','company_relationships'].includes(ref.parent.id)?'market_ugc':'market_state'):undefined);
        const read=async(readBatch:(batch:DocumentReference[])=>Promise<DocumentSnapshot[]>)=>{
            const get=async(physical:DocumentReference[])=>{
                const docs:DocumentSnapshot[]=[];
                for(let offset=0;offset<physical.length;offset+=100){
                    const batch=physical.slice(offset,offset+100);
                    const rows=await readBatch(batch);
                    reportNativeBatchRead(rows,!!context,context?undefined:fields);
                    const byPath=new Map(rows.map(doc=>[doc.ref.path,doc]));
                    for(const ref of batch){const doc=byPath.get(ref.path);if(!doc)throw Error('Retained read returned an incomplete batch');docs.push(doc);}
                }
                return docs;
            };
            const primary=await get(refs.map((ref,n)=>roots[n]?this.raw.doc(retainedPath(roots[n]!,ref.parent.id,ref.id)):ref));
            const missing=refs.flatMap((ref,n)=>roots[n]&&!primary[n].exists?[n]:[]);
            // Both probes share a snapshot, including when an editor moves the record.
            const alternateRoots=missing.map(n=>roots[n]==='market_state'?'market_ugc' as const:'market_state' as const);
            const fallback=await get(missing.map((n,i)=>this.raw.doc(retainedPath(alternateRoots[i],refs[n].parent.id,refs[n].id))));
            for(const [offset,n] of missing.entries()){
                primary[n]=fallback[offset];
                roots[n]=alternateRoots[offset];
            }
            return refs.map((ref,n)=>{
                if(!roots[n])return primary[n];
                if(primary[n].exists)this.remember(ref.path,roots[n]!);
                return this.logical(primary[n],ref);
            });
        };
        if(context)return read(batch=>context.reader.getAll(...batch));
        const options=fields?[{fieldMask:fields}]:[];
        if(roots.some(Boolean))return this.raw.runTransaction(tx=>read(batch=>tx.getAll(...batch,...options)),{readOnly:true});
        return read(batch=>this.raw.getAll(...batch,...options));
    }
    async query(collection: MarketCollection, build: (path: string) => Query, context?: RetainedContext,
        window?: {count: number; fromEnd: boolean; accepts: (id: string) => boolean}): Promise<DocumentSnapshot[]> {
        const mode = relocatesCollection(collection) ? await this.mode(context) : undefined;
        const relocated = this.readsNew(mode, context);
        const paths = relocated ? ['market_state','market_ugc'].map(root => `${root}/${collection}/records`) : [collection];
        const read = (reader?: RetainedContext['reader']) => Promise.all(paths.map(async path => {
            const query = build(path);
            const get = async (page: Query) => (reader ? await reader.get(page) as FirebaseFirestore.QuerySnapshot : await page.get()).docs;
            if (!window) return get(query);
            // Migrated originals can remain until readback. Page past them
            // within the same snapshot before applying the logical limit.
            const matched: DocumentSnapshot[] = [];
            let page = query;
            for (;;) {
                const docs = await get(page);
                const accepted = docs.filter(doc => window.accepts(doc.id));
                if (window.fromEnd) matched.unshift(...accepted); else matched.push(...accepted);
                if (matched.length >= window.count || docs.length < window.count)
                    return window.fromEnd ? matched.slice(-window.count) : matched.slice(0, window.count);
                page = window.fromEnd ? query.endBefore(docs[0]) : query.startAfter(docs[docs.length - 1]);
            }
        }));
        // A curated edit can move a record between the two roots. Both queries
        // must observe the same snapshot, or a valid move could omit/duplicate it.
        const pages=context?await read(context.reader):relocated
            ?await this.raw.runTransaction(tx=>read({get:ref=>tx.get(ref as Query),getAll:(...refs)=>tx.getAll(...refs)}),{readOnly:true})
            :await read();
        const ids=new Set<string>();
        return pages.flatMap(page=>page.map(doc=>{
            if(ids.has(doc.id))throw Error('Retained record exists in both destinations');ids.add(doc.id);
            return relocated?this.logical(doc,this.raw.collection(collection).doc(doc.id)):doc;
        }));
    }
    /** Both destinations and the old mirror change with the Parquet head in the
     * caller's transaction. After retirement, writes cannot recreate sources. */
    write(tx:Transaction,mode:RetainedMode,collection:MarketCollection,id:string,data:Data|undefined){
        const source=this.raw.collection(collection).doc(id);
        if(!mode.enabled||!relocatesCollection(collection)){
            if(data)tx.set(source,data);else tx.delete(source);return;
        }
        const root=data?retainedRoot(collection,id,data):undefined;
        for(const candidate of ['market_state','market_ugc'] as const){
            const ref=this.raw.doc(retainedPath(candidate,collection,id));
            if(candidate===root)tx.set(ref,data!);else tx.delete(ref);
        }
        if(!mode.cleanupAuthorized){if(data)tx.set(source,data);else tx.delete(source);}
    }
}
