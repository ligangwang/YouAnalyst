import {FieldValue, type Firestore, type DocumentData} from '../firebase/firestore';
import {normalizedCik, parseSecClassification, secCompanySyncPatch} from './sec';
import {taxonomyCatalog, taxonomyNode} from './catalog';
const catalog=taxonomyCatalog('SIC');

/** Run-scoped: reuse the collector's company snapshot and SEC submissions response. */
export function createSecCompanySync(db: Firestore, initial: Map<string, DocumentData>) {
  const companies = new Map(initial), issuers = new Map<string, Set<string>>();
  for (const [id, company] of companies) {
    if (company.isDeleted === true) continue;
    const cik = normalizedCik(company.cik);
    if (cik) { const ids = issuers.get(cik) ?? new Set<string>(); ids.add(id); issuers.set(cik, ids); }
  }
  return {
    register(id: string, mappedCik?: string) {
      const stored = normalizedCik(companies.get(id)?.cik);
      if (stored && mappedCik && stored !== mappedCik) throw Error(`SEC CIK conflict for ${id}; review required`);
      const cik = stored ?? mappedCik;
      if (!cik) throw Error(`No SEC CIK mapping for ${id}`);
      const ids = issuers.get(cik) ?? new Set<string>();
      ids.add(id); issuers.set(cik, ids);
      return cik;
    },
    async observe(cik: string, value: unknown) {
      const entry = parseSecClassification(value, cik);
      if (entry && !taxonomyNode('SIC',entry.code)) {
        throw Error(`SEC SIC catalog update required: ${entry.code}`);
      }
      for (const id of issuers.get(cik) ?? []) {
        const previous = companies.get(id);
        if (!previous) continue;
        const at = new Date().toISOString();
        if (!secCompanySyncPatch(previous, cik, entry, catalog.version, at)) continue;
        // Only changed records incur a read; recheck concurrent edits before writing.
        const current = await db.runTransaction(async tx => {
          const ref = db.collection('companies').doc(id), doc = await tx.get(ref);
          if (!doc.exists) return undefined;
          const data = doc.data()!;
          const patch = secCompanySyncPatch(data, cik, entry, catalog.version, at);
          if (patch) tx.update(ref, {...patch, updatedAt: FieldValue.serverTimestamp()});
          return {...data, ...patch};
        });
        if (current) companies.set(id, current); else companies.delete(id);
      }
    },
  };
}
