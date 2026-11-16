import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
export const FUNDAMENTALS_CONTROL='collectors/_market_parquet_company_fundamentals_control';
export type FundamentalsMode={ready:boolean;cleanupAuthorized:boolean;cleanedCollections:Set<string>};
export function fundamentalsMode(doc:DocumentSnapshot):FundamentalsMode {
 const data=doc.data();
 if(data?.version!==1||typeof data.ready!=='boolean')throw Error('Fundamentals migration control is missing or invalid');
 return {ready:data.ready,cleanupAuthorized:data.cleanupAuthorized===true,cleanedCollections:new Set(Array.isArray(data.cleanedCollections)?data.cleanedCollections:[])};
}
/** Independent source-retirement gate: the completed market migration cannot
 * authorize deletion of fundamentals before its own production verification. */
export class FundamentalsControl {
 private cached?:{until:number;value:Promise<FundamentalsMode>};
 private stop?:()=>void;
 constructor(private raw:Firestore,onMode?:(ready:boolean)=>void){
  if(onMode)this.stop=raw.doc(FUNDAMENTALS_CONTROL).onSnapshot(doc=>{try{const mode=fundamentalsMode(doc);this.cached={until:Date.now()+10000,value:Promise.resolve(mode)};onMode(mode.ready);}catch{this.cached=undefined;}},()=>{this.cached=undefined;});
 }
 async read(){
  if(!this.cached||this.cached.until<Date.now()){
   const value=this.raw.doc(FUNDAMENTALS_CONTROL).get().then(fundamentalsMode);
   this.cached={until:Date.now()+1000,value};
   value.catch(()=>{if(this.cached?.value===value)this.cached=undefined;});
  }
  return this.cached.value;
 }
 close(){this.stop?.();this.cached=undefined;}
}
