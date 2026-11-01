import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
import {loadThemeEnrolledCompanies,loadSingleThemeCompanies} from '../../knowledge-graph/company-cache';
import {loadCompanyDocuments} from '../../company-document-cache';
import type {KnowledgeGraph} from '../../knowledge-graph/model';
import type {CompanyThemeId} from '../../company-themes/model';
import {loadCollectionCompanies} from '../../company-themes/service';
import {approvedCompanyNewsSources, type NewsSource} from './sources';
import {changeCached} from '../../change-cache';
import {readCollectionCompanies} from '../../company-support/collection-reader';
import {supportedCompanyUniverse} from '../../company-support/model';

/** The page and graph share the same live membership query, never the market file. */
export async function loadNewsSourceCompanies(db:Firestore,theme:CompanyThemeId){
  return (await(theme==='ai'?loadThemeEnrolledCompanies(db,true):loadSingleThemeCompanies(db,theme))).docs;
}
export async function graphNewsSources(db:Firestore,graph:KnowledgeGraph,members:DocumentSnapshot[]){
  const needed=new Set(graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>node.id));
  const found=new Map(members.filter(doc=>needed.has(doc.id)).map(doc=>[doc.id,doc]));
  // Graph construction already loaded these relationship-only neighbors. Reuse
  // their exact-ID cache, including missing/deleted records and later updates.
  const missing=[...needed].filter(id=>!found.has(id));
  for(const doc of await loadCompanyDocuments(db,'companies',missing))if(doc.exists)found.set(doc.id,doc);
  return approvedCompanyNewsSources([...found.values()].map(doc=>({...doc.data(),id:doc.id})));
}

/** Reuse one bounded projection for scope and publisher configuration. */
export async function loadNewsCollectionContext(db:Firestore){
  const records=await readCollectionCompanies(db,['newsSources']);
  return {graph:supportedCompanyUniverse(records),sources:approvedCompanyNewsSources(records)};
}

/** The canonical company record owns membership and approved publisher configuration. */
export async function loadNewsSources(db:Firestore):Promise<NewsSource[]>{
  return changeCached(db,'news-sources',['companies'],async()=>{
    const docs=await loadCollectionCompanies(db,undefined,'news'),sources=approvedCompanyNewsSources(docs.map(doc=>({...doc.data(),id:doc.id})));
    return sources;
  });
}
