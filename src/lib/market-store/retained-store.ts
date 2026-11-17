import type {Firestore,DocumentReference,DocumentSnapshot,Query,Transaction} from 'firebase-admin/firestore';
import {isMarketCollection,type MarketCollection,hasAuthoredContent} from './policy';
import type {Data} from './value';
import {reportNativeBatchRead} from './native-read-observability';

export const RETAINED_CONTROL='collectors/_market_parquet_retained_control';
export type RetainedMode={enabled:boolean;ready:boolean;cleanupAuthorized:boolean};
type Reader={get:(ref:Query|DocumentReference)=>Promise<unknown>;getAll:(...refs:DocumentReference[])=>Promise<DocumentSnapshot[]>};
export type RetainedContext={reader:Reader;retainedMode?:RetainedMode};
export const relocatesCollection=(name:string):name is MarketCollection=>isMarketCollection(name)&&name!=='events';
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
    private cached?:{until:number;value:Promise<RetainedMode>};
    private locations=new Map<string,'market_state'|'market_ugc'>();
    private remember(path:string,root:'market_state'|'market_ugc'){
        // Bound routing hints independently of payload caches. An absent hinted
        // record always falls back to both destinations, so moves stay visible.
        if(Buffer.byteLength(path)>256)return;
        this.locations.delete(path);this.locations.set(path,root);
        while(this.locations.size>1024)this.locations.delete(this.locations.keys().next().value!);
    }
    constructor(private raw:Firestore,private stagedReads=false){}
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
    async documents(refs:DocumentReference[],context?:RetainedContext,fields?:string[]):Promise<DocumentSnapshot[]>{
        const relocate=refs.some(ref=>relocatesCollection(ref.path.split('/')[0]));
        const mode=relocate?await this.mode(context):undefined;
        const roots=refs.map(ref=>this.readsNew(mode,context)&&relocatesCollection(ref.path.split('/')[0])
            ?this.locations.get(ref.path)??(['companies','company_relationships'].includes(ref.parent.id)?'market_ugc':'market_state'):undefined);
        const get=async(physical:DocumentReference[])=>{
            const docs:DocumentSnapshot[]=[];
            for(let offset=0;offset<physical.length;offset+=100){
                const batch=physical.slice(offset,offset+100);
                const rows=context?await context.reader.getAll(...batch):await this.raw.getAll(...batch,...(fields?[{fieldMask:fields}]:[]));
                reportNativeBatchRead(rows,!!context,context?undefined:fields);docs.push(...rows);
            }
            return docs;
        };
        const primary=await get(refs.map((ref,n)=>roots[n]?this.raw.doc(retainedPath(roots[n]!,ref.parent.id,ref.id)):ref));
        const missing=refs.flatMap((ref,n)=>roots[n]&&!primary[n].exists?[n]:[]);
        // Re-read both locations together after a miss: a concurrent move could
        // have installed the first location after its initial read.
        const fallback=await get(missing.flatMap(n=>(['market_state','market_ugc'] as const).map(root=>this.raw.doc(retainedPath(root,refs[n].parent.id,refs[n].id)))));
        for(const [offset,n] of missing.entries()){
            const state=fallback[offset*2],ugc=fallback[offset*2+1];
            if(state.exists&&ugc.exists)throw Error('Retained record exists in both destinations');
            primary[n]=ugc.exists?ugc:state;roots[n]=ugc.exists?'market_ugc':'market_state';
        }
        return refs.map((ref,n)=>{
            if(!roots[n])return primary[n];
            if(primary[n].exists)this.remember(ref.path,roots[n]!);
            return this.logical(primary[n],ref);
        });
    }
    async query(collection:MarketCollection,build:(path:string)=>Query,context?:RetainedContext):Promise<DocumentSnapshot[]>{
        const mode=relocatesCollection(collection)?await this.mode(context):undefined;
        const relocated=this.readsNew(mode,context);
        const paths=relocated?['market_state','market_ugc'].map(root=>`${root}/${collection}/records`):[collection];
        const pages=await Promise.all(paths.map(async path=>{
            const query=build(path);
            return context?await context.reader.get(query) as FirebaseFirestore.QuerySnapshot:await query.get();
        }));
        const ids=new Set<string>();
        return pages.flatMap(page=>page.docs.map(doc=>{
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
