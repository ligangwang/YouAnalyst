import type {Firestore} from 'firebase-admin/firestore';
import {loadCollectionCompanies} from '../../company-themes/service';
import {approvedCompanyNewsSources, type NewsSource} from './sources';
import {changeCached} from '../../change-cache';
import {readCollectionCompanies} from '../../company-support/collection-reader';
import {supportedCompanyUniverse} from '../../company-support/model';

/** Reuse one bounded projection for scope and publisher configuration. */
export async function loadNewsCollectionContext(db:Firestore){
  const records=await readCollectionCompanies(db,['newsSources']);
  return {graph:supportedCompanyUniverse(records),sources:approvedCompanyNewsSources(records)};
}

/** The canonical company record owns membership and approved publisher configuration. */
export async function loadNewsSources(db:Firestore):Promise<NewsSource[]>{
  return changeCached(db,'news-sources',['companies'],async()=>{
    const docs=await loadCollectionCompanies(db),sources=approvedCompanyNewsSources(docs.map(doc=>({...doc.data(),id:doc.id})));
    return sources;
  });
}
