import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { validateThemeCatalog, type ThemeCatalog } from './catalog-model';

type State = { value?: ThemeCatalog; expires: number; pending?: Promise<ThemeCatalog> };
const states = new WeakMap<Firestore,State>();
/** Firestore is authoritative. Retain a validated snapshot on outages, never replace it with code defaults. */
export async function loadThemeCatalog(db=getAdminFirestore()): Promise<ThemeCatalog> {
  let state=states.get(db);
  if(!state){state={expires:0};states.set(db,state);}
  if(state.value && Date.now()<state.expires)return state.value;
  if(state.pending)return state.pending;
  const current=state;
  current.pending=(async()=>{
    try {
      const snapshot=await db.collection('investment_themes').where('status','==','PUBLISHED')
        .select('parentId','names','descriptions','order','isDeleted').limit(2001).get();
      if(snapshot.docs.length>2000)throw new Error('Theme catalog exceeds safe size');
      const nodes=snapshot.docs.filter(doc=>doc.data().isDeleted!==true).map(doc=>{
        const data=doc.data();
        return {id:doc.id,parentId:data.parentId,names:data.names,order:data.order,
          ...(data.descriptions?{descriptions:data.descriptions}:{})};
      });
      current.value=validateThemeCatalog(nodes);
      current.expires=Date.now()+60_000;
    } catch(error) {
      if(!current.value)throw error;
      console.error('Theme catalog refresh failed; retaining last validated catalog',error);
      current.expires=Date.now()+10_000;
    }
    return current.value!;
  })().finally(()=>{current.pending=undefined;});
  return current.pending;
}
