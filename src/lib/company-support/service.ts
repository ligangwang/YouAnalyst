import type { Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase/admin';
import { localQuery } from '../local-cache/entities';
import { exchangeRegion, type ExchangeRegion } from '../market-companies/exchange-region';
import type { ThemedCompany } from '../company-themes/model';
import { isSupportedCompany, supportedCompanyUniverse } from './model';

/** One single-field Firestore index; region filtering cannot require a composite index. */
export async function loadSupportedCompanies(db: Firestore, region?: ExchangeRegion) {
  const query = db.collection('companies').where('onboarding.status', '==', 'SUPPORTED');
  const docs = typeof db.collection('companies').onSnapshot === 'function'
    ? [...(await localQuery(db, 'companies:supported', query)).values()]
    : (await query.get()).docs;
  return docs.filter(doc => isSupportedCompany(doc.data() ?? {}) && (!region || exchangeRegion(doc.id) === region))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

export async function loadSupportedCompanyUniverse(db = getAdminFirestore()) {
  return supportedCompanyUniverse((await loadSupportedCompanies(db)).map(doc => ({...doc.data(), id: doc.id} as ThemedCompany)));
}
