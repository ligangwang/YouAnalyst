import type {DocumentData, Timestamp} from 'firebase-admin/firestore';
import {normalizedCik} from '../industry-classification/sec';
import {instrumentFromCompany, instrumentId, validateInstrument, type Instrument} from './model';

export type CompanyRow = {id: string; data: DocumentData; updateTime: Timestamp};
export type InstrumentMigrationPlan = {
  version: 1; projectId: string; observedAt: string;
  instruments: {id: string; legacyId: string; companyId: string; sourceUpdateTime: Timestamp; data: Instrument}[];
  aliases: {id: string; companyId: string; sourceUpdateTime: Timestamp}[];
  review: {ids: string[]; reason: string}[];
};
const published = (d: DocumentData) => Array.isArray(d.themeIds) && d.themeIds.length > 0 || d.inGraph?.status === 'PUBLISHED';
const richness = (d: DocumentData) => ['legalName','names','profile','description','classification','themeMemberships'].filter(k => d[k]).length;

/** Keep legacy company IDs immutable. Only verified CIK equivalence consolidates issuers. */
export function planInstrumentMigration(rows: CompanyRow[], projectId: string, observedAt: string): InstrumentMigrationPlan {
  const plan: InstrumentMigrationPlan = {version: 1, projectId, observedAt, instruments: [], aliases: [], review: []};
  const active = rows.filter(r => !r.id.startsWith('_') && r.data.isDeleted !== true);
  const byId = new Map(active.map(r => [r.id, r]));
  if (byId.size !== active.length) throw Error('Duplicate company IDs');
  const canonical = new Map(active.map(r => [r.id, r.id])), groups = new Map<string, CompanyRow[]>();
  for (const row of active) {
    let cik: string | undefined;
    try { cik = normalizedCik(row.data.cik); } catch { plan.review.push({ids: [row.id], reason: 'invalid_cik'}); }
    if (cik) groups.set(cik, [...(groups.get(cik) ?? []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Do not silently discard divergent editorial decisions, classifications or identities.
    const editorial = group.filter(r => published(r.data));
    const conflicts = ['taxonomy','classification','legalName'].some(key => new Set(group.filter(r => r.data[key]).map(r => JSON.stringify(r.data[key]))).size > 1);
    const targets = [...new Set(group.map(r => r.data.supersededByCompanyId).filter(Boolean))];
    if (conflicts || editorial.length > 1 || targets.length > 1) {
      plan.review.push({ids: group.map(r => r.id), reason: 'issuer_merge_requires_review'}); continue;
    }
    const ranked = [...group].sort((a,b) => Number(published(b.data)) - Number(published(a.data)) || richness(b.data) - richness(a.data) || a.id.localeCompare(b.id));
    const target = targets[0] ? byId.get(String(targets[0])) : ranked[0];
    if (!target || !group.includes(target) || target.data.supersededByCompanyId) {plan.review.push({ids: group.map(r=>r.id), reason:'invalid_existing_alias'}); continue;}
    for (const row of group) canonical.set(row.id, target.id);
  }
  for (const row of active) {
    const companyId = canonical.get(row.id)!;
    if (companyId !== row.id) plan.aliases.push({id: row.id, companyId, sourceUpdateTime: row.updateTime});
    const data = instrumentFromCompany(row.id, row.data, companyId);
    if (!data) {
      if(row.data.listingStatus==='PUBLIC'&&Array.isArray(row.data.listings)&&row.data.listings.length>1)plan.review.push({ids:[row.id],reason:'multiple_global_listings_require_review'});
      continue;
    }
    // This is a new migration observation, not a fabricated source observation timestamp.
    if (data.sourceMetadata.observedAt === '1970-01-01T00:00:00.000Z') data.sourceMetadata.observedAt = observedAt;
    if (!data.instrumentType) plan.review.push({ids: [row.id], reason: 'instrument_type_unverified'});
    plan.instruments.push({id: instrumentId(row.id), legacyId: row.id, companyId, sourceUpdateTime: row.updateTime, data: validateInstrument(data)});
  }
  return plan;
}
