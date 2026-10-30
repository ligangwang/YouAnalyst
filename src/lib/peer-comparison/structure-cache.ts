/** Bounded derived data only; source listeners remain the authority. */
export class PeerStructureCache<T> {
 private entries=new Map<string,{version:string;expires:number;value?:T;pending?:Promise<T>;bytes:number}>();
 constructor(private maxEntries=8,private maxBytes=8*1024*1024,private now=Date.now){}
 load(key:string,version:()=>string,build:()=>Promise<T>):Promise<T>{
  const current=version(),old=this.entries.get(key);
  if(old&&old.version===current&&(old.pending||old.expires>this.now())){
   this.entries.delete(key);this.entries.set(key,old);
   return old.pending??Promise.resolve(old.value!);
  }
  const entry={version:current,expires:0,bytes:0} as {version:string;expires:number;value?:T;pending?:Promise<T>;bytes:number};
  this.entries.set(key,entry);
  entry.pending=Promise.resolve().then(build).then(value=>{
   // A source update during construction must not label an older result current.
   if(this.entries.get(key)===entry){
    if(version()!==current)this.entries.delete(key);
    else {entry.value=value;entry.pending=undefined;entry.bytes=Buffer.byteLength(JSON.stringify(value));entry.expires=this.now()+60_000;this.trim();}
   }
   return value;
  },error=>{if(this.entries.get(key)===entry)this.entries.delete(key);throw error;});
  this.trim();return entry.pending;
 }
 private trim(){
  let bytes=[...this.entries.values()].reduce((sum,e)=>sum+e.bytes,0);
  for(const [key,entry] of this.entries){
   if(this.entries.size<=this.maxEntries&&bytes<=this.maxBytes)break;
   this.entries.delete(key);bytes-=entry.bytes;
  }
 }
}
