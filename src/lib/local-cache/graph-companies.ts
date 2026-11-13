import type {Firestore,DocumentSnapshot,QuerySnapshot} from 'firebase-admin/firestore';
import {GRAPH_COMPANY_FIELDS} from '../company-themes/company-query';
import {Watch,track} from './watch';

const fields=[...GRAPH_COMPANY_FIELDS,'newsSources','onboarding','supersededByCompanyId'];
declare global {var __publishedGraphCompaniesV1:WeakMap<Firestore,Watch<DocumentSnapshot[]>>|undefined;}
const stores=globalThis.__publishedGraphCompaniesV1??=new WeakMap<Firestore,Watch<DocumentSnapshot[]>>();
function compact(doc:DocumentSnapshot):DocumentSnapshot{
  // Read individual fields: decoding data() expands unrelated search payloads.
  const data=Object.fromEntries(fields.flatMap(field=>{const value=doc.get(field);return value===undefined?[]:[[field,value]];}));
  return {id:doc.id,exists:doc.exists,ref:doc.ref,readTime:doc.readTime,
    data:()=>structuredClone(data),get:(field:string)=>structuredClone(field.split('.').reduce<unknown>((value,key)=>value&&typeof value==='object'?(value as Record<string,unknown>)[key]:undefined,data))} as DocumentSnapshot;
}
/** The first listener snapshot seeds the shared cache; subsequent snapshots update it. */
export function loadPublishedGraphCompanies(db:Firestore):Promise<DocumentSnapshot[]>{
  let watch=stores.get(db);
  if(!watch){
    const query=db.collection('companies').where('inGraph.status','==','PUBLISHED');
    watch=track(new Watch<DocumentSnapshot[]>((next,error)=>{
      let last: QuerySnapshot['readTime'] | undefined;
      return query.onSnapshot(snapshot => {
        const time = snapshot.readTime;
        if (last && (time.seconds < last.seconds || (time.seconds === last.seconds && time.nanoseconds < last.nanoseconds))) return;
        last = time;
        next(snapshot.docs.map(compact).filter(doc => doc.get('isDeleted') !== true));
      }, error);
    }));
    const created=watch,close=watch.close.bind(watch);
    watch.close=()=>{if(stores.get(db)===created)stores.delete(db);close();};
    stores.set(db,watch);
  }
  return watch.read();
}
