import { localDocuments } from '../local-cache/entities';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { changeCached, readCacheState, withCacheReadScope } from '../change-cache';
import { COMPANY_THEMES } from '../company-themes/model';
import { companyVersions, hasCompanyIndex, loadCompanyDocuments } from '../company-document-cache';
import type { CompanyChange } from '../company-change-index';

type Enrollment = { docs: Map<string, DocumentSnapshot>; versions: Record<string, CompanyChange>; generation: string };
const enrolled = new WeakMap<Firestore, Promise<Enrollment>>();

/** Reuse enrollment records across graph rebuilds until company data changes. */
export function loadThemeEnrolledCompanies(db: Firestore) {
  return withCacheReadScope(async () => {
    const local=await localDocuments(db,'companies');if(local)return {docs:local};
    const state = await readCacheState(db);
    if (!hasCompanyIndex(state, 'companies')) {
      enrolled.delete(db);
      return changeCached(db, 'theme-enrolled-companies', ['companies'], () =>
        db.collection('companies').where('themeIds', 'array-contains-any', [...COMPANY_THEMES]).get());
    }
    // Serialize enrollment updates; publish a new immutable map only after all reads succeed.
    const previous = enrolled.get(db);
    const next = (async () => {
      const old = await previous?.catch(() => undefined);
      const generation = state.companyIndexes!.companies.generation;
      const versions = await companyVersions(db, 'companies', state, Object.keys(state.companyIndexes!.companies.shards));
      if (!old || old.generation !== generation) {
        const snapshot = await db.collection('companies').where('themeIds', 'array-contains-any', [...COMPANY_THEMES]).get();
        return {docs:new Map(snapshot.docs.map(doc => [doc.id, doc])),versions,generation};
      }
      const ids = Object.entries(versions).filter(([key,value]) => old.versions[key]?.version !== value.version).map(([,value]) => value.id);
      const docs = new Map(old.docs);
      for (const doc of await loadCompanyDocuments(db,'companies',ids)) {
        if (doc.exists && (doc.get('themeIds') ?? []).some((theme:string) => (COMPANY_THEMES as readonly string[]).includes(theme))) docs.set(doc.id,doc);
        else docs.delete(doc.id);
      }
      return {docs,versions,generation};
    })();
    enrolled.set(db,next);
    try { return {docs:[...(await next).docs.values()]}; }
    catch(error) { if(enrolled.get(db)===next) { if(previous)enrolled.set(db,previous);else enrolled.delete(db); } throw error; }
  });
}
