import type {Firestore} from 'firebase-admin/firestore';
import {loadCollectionCompanies} from '../../company-themes/service';
import {approvedCompanyNewsSources, type NewsSource} from './sources';

const caches=new WeakMap<Firestore,{expires:number;sources:NewsSource[]}>();
const pending=new WeakMap<Firestore,Promise<NewsSource[]>>();
/** The canonical company record owns membership and approved publisher configuration. */
export async function loadNewsSources(db:Firestore):Promise<NewsSource[]>{
  const cached=caches.get(db);if(cached&&cached.expires>Date.now())return cached.sources;
  const current=pending.get(db);if(current)return current;
  const request=(async()=>{
    const docs=await loadCollectionCompanies(db),sources=approvedCompanyNewsSources(docs.map(doc=>({...doc.data(),id:doc.id})));
    caches.set(db,{sources,expires:Date.now()+60_000});return sources;
  })();
  pending.set(db,request);
  try{return await request;}finally{if(pending.get(db)===request)pending.delete(db);}
}
