import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { validateThemeCatalog, type ThemeCatalog } from './catalog-model';

type State = { value?: ThemeCatalog; pending?: Promise<ThemeCatalog> };
declare global {var __companyThemeCatalogV1:WeakMap<Firestore,State>|undefined;}
const states = globalThis.__companyThemeCatalogV1??=new WeakMap<Firestore,State>();
/** Load once per server lifetime. A new deployment/process loads the published catalog again. */
export async function loadThemeCatalog(db=getAdminFirestore()): Promise<ThemeCatalog> {
  let state=states.get(db);
  if(!state){state={};states.set(db,state);}
  if(state.value)return state.value;
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

    } catch(error) {
      if(!current.value)throw error;
      console.error('Theme catalog refresh failed; retaining last validated catalog',error);

    }
    return current.value!;
  })().finally(()=>{current.pending=undefined;});
  return current.pending;
}
