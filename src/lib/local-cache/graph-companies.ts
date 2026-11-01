import type {Firestore,DocumentSnapshot,QuerySnapshot} from 'firebase-admin/firestore';
import {GRAPH_COMPANY_FIELDS} from '../company-themes/company-query';
import {withLiveCompanyReads} from './company-directory';
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
/** Only published graph members, with a projected first read and live handoff.
 * Worker directory readers remain separate. A cold full listener cannot delay
 * the first page; later snapshots retain only graph/news fields. */
export function loadPublishedGraphCompanies(db:Firestore):Promise<DocumentSnapshot[]>{
  let watch=stores.get(db);
  if(!watch){
    const query=db.collection('companies').where('inGraph.status','==','PUBLISHED');
    watch=track(new Watch<DocumentSnapshot[]>((next,error)=>{
      let stopped=false,unsubscribe:(()=>void)|undefined,last:QuerySnapshot['readTime']|undefined;
      const stop=()=>{stopped=true;unsubscribe?.();};
      const publish=(snapshot:QuerySnapshot)=>{
        const time=snapshot.readTime;
        if(stopped||last&&(last.seconds>time.seconds||last.seconds===time.seconds&&last.nanoseconds>time.nanoseconds))return;
        last=time;next(snapshot.docs.map(compact).filter(doc=>doc.get('isDeleted')!==true));
      };
      const fail=(reason:Error)=>{stop();error(reason);};
      void withLiveCompanyReads(()=>query.select(...fields).get()).then(snapshot=>{
        if(stopped)return;publish(snapshot);
        if(typeof query.onSnapshot==='function'){
          const detach=query.onSnapshot(publish,fail);if(stopped)detach();else unsubscribe=detach;
        }
      }).catch(fail);
      return stop;
    }));
    const created=watch,close=watch.close.bind(watch);
    watch.close=()=>{if(stores.get(db)===created)stores.delete(db);close();};
    stores.set(db,watch);
  }
  return watch.read();
}
