import type {DocumentReference,DocumentSnapshot} from 'firebase-admin/firestore';
import {encode} from '../central-cache/codec';
import {shardFor} from './files';

type Entry={collection:string;shard:string;until:number;bytes:number;value:Promise<DocumentSnapshot>};
/** Reuse unchanged overlays across different broad queries. Head notifications
 * invalidate individual shards, including reads still in flight. */
export class RetainedReadCache {
    private entries=new Map<string,Entry>();
    constructor(private budget=16*1024*1024,private now=Date.now){}
    invalidate(collection?:string,shards?:ReadonlySet<string>){
        for(const [key,entry] of this.entries)
            if(!collection||entry.collection===collection&&(!shards||shards.has(entry.shard)))this.entries.delete(key);
    }
    async read(refs:DocumentReference[],fields:string[]|undefined,load:(refs:DocumentReference[])=>Promise<DocumentSnapshot[]>){
        const mask=JSON.stringify(fields?[...fields].sort():null);
        const missing:DocumentReference[]=[],waiting=new Map<string,{entry:Entry;resolve:(doc:DocumentSnapshot)=>void;reject:(error:unknown)=>void}>();
        const values=refs.map(ref=>{
            const key=ref.path+':'+mask,old=this.entries.get(key);
            if(old&&old.until>this.now()){this.entries.delete(key);this.entries.set(key,old);return old.value;}
            let resolve!:(doc:DocumentSnapshot)=>void,reject!:(error:unknown)=>void;
            const value=new Promise<DocumentSnapshot>((yes,no)=>{resolve=yes;reject=no;});
            const entry={collection:ref.path.split('/')[0],shard:shardFor(ref.id),until:Infinity,bytes:512,value};
            this.entries.set(key,entry);waiting.set(key,{entry,resolve,reject});missing.push(ref);return value;
        });
        // Attach handlers before loading, including synchronous loader failures.
        const result=Promise.all(values);
        if(missing.length)void (async()=>{
            try{
                const docs=await load(missing),byPath=new Map(docs.map(doc=>[doc.ref.path,doc]));
                if(missing.some(ref=>!byPath.has(ref.path)))throw Error('Incomplete retained cache batch');
                for(const ref of missing){
                    const key=ref.path+':'+mask,{entry,resolve}=waiting.get(key)!,doc=byPath.get(ref.path)!;
                    entry.until=this.now()+60000;
                    entry.bytes=512+Buffer.byteLength(JSON.stringify(encode(doc.exists?doc.data():null)))*2;
                    resolve(doc);
                }
                let bytes=[...this.entries.values()].reduce((sum,e)=>sum+e.bytes,0);
                for(const [key,entry] of this.entries){
                    if(bytes<=this.budget&&this.entries.size<=32768)break;
                    this.entries.delete(key);bytes-=entry.bytes;
                }
            }catch(error){
                for(const [key,{entry,reject}] of waiting){if(this.entries.get(key)===entry)this.entries.delete(key);reject(error);}
            }
        })();
        return result;
    }
}
