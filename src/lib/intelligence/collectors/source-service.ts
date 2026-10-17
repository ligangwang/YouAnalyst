import type {Firestore} from 'firebase-admin/firestore';
import {loadCollectionCompanies} from '../../company-themes/service';
import {approvedCompanyNewsSources, type NewsSource} from './sources';
import {changeCached} from '../../change-cache';

/** The canonical company record owns membership and approved publisher configuration. */
export async function loadNewsSources(db:Firestore):Promise<NewsSource[]>{
  return changeCached(db,'news-sources',['companies'],async()=>{
    const docs=await loadCollectionCompanies(db),sources=approvedCompanyNewsSources(docs.map(doc=>({...doc.data(),id:doc.id})));
    return sources;
  });
}
