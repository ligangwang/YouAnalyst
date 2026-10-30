import {companyDirectoryEnabled,withSharedCompanyQuery,withCompanyViewQuery} from '../local-cache/company-directory';
import {COLLECTION_COMPANY_FIELDS} from './collection-reader';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { localQuery } from '../local-cache/entities';
import { exchangeRegion, type ExchangeRegion } from '../market-companies/exchange-region';
import type { ThemedCompany } from '../company-themes/model';
import { isSupportedCompany, supportedCompanyUniverse } from './model';

/** One single-field Firestore index; region filtering cannot require a composite index. */
export async function loadSupportedCompanies(db: Firestore, region?: ExchangeRegion, projection?:'universe'|'news') {
  const projected=projection!==undefined&&await withSharedCompanyQuery(()=>Promise.resolve(companyDirectoryEnabled(db)));
  const source = db.collection('companies').where('onboarding.status', '==', 'SUPPORTED');
  const query=projected?source.select(...COLLECTION_COMPANY_FIELDS,...(projection==='news'?['newsSources']:[])):source;
  const docs = typeof db.collection('companies').onSnapshot === 'function'
    ? [...(await (projected?withCompanyViewQuery(()=>localQuery(db,'companies:supported',query)):localQuery(db,'companies:supported',query))).values()]
    : (await query.get()).docs;
  return docs.filter(doc => isSupportedCompany(doc.data() ?? {}) && (!region || exchangeRegion(doc.id) === region))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

export async function loadSupportedCompanyUniverse(db = getAdminFirestore(),region?:ExchangeRegion) {
  return supportedCompanyUniverse((await loadSupportedCompanies(db,region,'universe')).map(doc => ({...doc.data(), id: doc.id} as ThemedCompany)));
}
