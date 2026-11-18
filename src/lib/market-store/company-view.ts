import {FieldPath,Filter,type Firestore,type DocumentSnapshot,type Timestamp} from 'firebase-admin/firestore';

// Bounded separately from the Parquet working set, within the 6 GiB web allocation.
export const COMPANY_VIEW_BYTES=256*1024*1024;
export const companyViewEnabled=()=>['ifindata-web','market-parquet-ui-probe'].includes(process.env.K_SERVICE??'')
    &&process.env.MARKET_COMPANY_VIEW!=='0';

/** One snapshot spans both roots, so an atomic editorial move cannot briefly
 * disappear or appear twice. Document-name bounds include descendants of the
 * exact company parent, regardless of the characters in a company ID. */
export function companyViewQuery(raw:Firestore){
    return raw.collectionGroup('records').where(Filter.or(...['market_state','market_ugc'].map(root=>Filter.and(
        Filter.where(FieldPath.documentId(),'>',raw.doc(root+'/companies')),
        Filter.where(FieldPath.documentId(),'<',raw.doc(root+'/companies!')),
    ))));
}

export class CompanyView {
    private docs=new Map<string,DocumentSnapshot>();
    private current?:Map<string,DocumentSnapshot>;
    private sizes=new Map<string,number>();
    private bytes=0;
    private stop?:()=>void;
    private pending?:Promise<void>;
    private disabled=false;
    private retryAt?:number;
    private generation=0;
    private finish?:()=>void;
    private through?:Timestamp;
    private required?:Timestamp;
    afterCommit(at:Timestamp){if(!this.required||at.valueOf()>this.required.valueOf())this.required=at;}
    constructor(private raw:Firestore,private changed:(ids:string[])=>void,private budget=COMPANY_VIEW_BYTES,
        private recovery:{now?:()=>number;retryDelayMs?:number;initializationTimeoutMs?:number}={}){}
    close(){this.disabled=true;this.retryAt=undefined;this.generation++;this.stop?.();this.stop=undefined;this.docs.clear();this.current=undefined;this.sizes.clear();this.bytes=0;this.finish?.();}
    async read(start=false):Promise<Map<string,DocumentSnapshot>|undefined>{
        // A point read arriving during bootstrap keeps its fast native path.
        // Only the broad query that needs the view waits for initialization.
        // A transient listener failure must not disable caching for the whole
        // instance lifetime. Only a later broad query retries, after a cooldown;
        // point reads retain their immediate native fallback during recovery.
        if(this.disabled&&start&&this.retryAt!==undefined&&(this.recovery.now?.()??Date.now())>=this.retryAt){
            this.disabled=false;this.retryAt=undefined;this.pending=undefined;this.finish=undefined;
            console.info(JSON.stringify({event:'company_view_retry'}));
        }
        if(this.disabled||!start&&!this.current)return undefined;
        if(!this.pending){
            const generation=this.generation;
            this.pending=new Promise(resolve=>{this.finish=resolve;});
            const fail=(error:unknown,retryable=false)=>{
                if(generation!==this.generation)return;
                console.warn(JSON.stringify({event:'company_view_fallback',reason:error instanceof Error?error.message:String(error),retryable}));
                this.close();
                if(retryable)this.retryAt=(this.recovery.now?.()??Date.now())+(this.recovery.retryDelayMs??60000);
                this.changed([]);
            };
            // Bound the request wait, not the lifetime of the initial snapshot.
            // Cancelling a slow bootstrap discards its progress and forces the
            // next broad request to read the same collection again. Keep this
            // single, memory-bounded subscription alive for late completion.
            const timer=setTimeout(()=>{
                if(generation!==this.generation)return;
                console.warn(JSON.stringify({event:'company_view_wait_expired',listenerContinues:true}));
                this.finish?.();
            },this.recovery.initializationTimeoutMs??45000);
            this.pending.then(()=>clearTimeout(timer));
            this.stop=companyViewQuery(this.raw).onSnapshot(snapshot=>{
                if(generation!==this.generation)return;
                try{
                    const changes=snapshot.docChanges(),ids=new Set<string>();
                    // Remove old locations first: root moves arrive atomically,
                    // but Firestore does not promise a useful change ordering.
                    for(const change of changes){
                        const doc=change.doc,path=doc.ref.path;
                        if(!/^market_(state|ugc)\/companies\/records\/[^/]+$/.test(path))throw Error('Unexpected company view path');
                        ids.add(doc.id);this.bytes-=this.sizes.get(path)??0;this.sizes.delete(path);this.docs.delete(path);
                    }
                    for(const change of changes)if(change.type!=='removed'){
                        const doc=change.doc,path=doc.ref.path;
                        const size=Buffer.byteLength(JSON.stringify(doc.data()))*2+512;
                        this.bytes+=size;
                        if(this.bytes>this.budget)throw Error('Company view exceeds memory allowance');
                        this.sizes.set(path,size);this.docs.set(path,doc);
                    }
                    const logical=new Map<string,DocumentSnapshot>();
                    for(const doc of this.docs.values()){
                        if(logical.has(doc.id))throw Error('Retained company exists in both destinations');
                        logical.set(doc.id,doc);
                    }
                    this.current=logical;
                    this.through=snapshot.readTime;
                    this.changed([...ids]);this.finish?.();
                    console.info(JSON.stringify({event:'company_view_update',documents:this.docs.size,changes:changes.length,estimatedBytes:this.bytes}));
                }catch(error){fail(error);}
            },error=>fail(error,true));
        }
        await this.pending;
        // Read-your-writes: use native reads until this listener has observed a
        // local commit. Never cache a stale overlay after committed() returns.
        return this.disabled||this.required&&(!this.through||this.through.valueOf()<this.required.valueOf())?undefined:this.current;
    }
}
