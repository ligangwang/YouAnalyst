import { localDocuments } from '../local-cache/entities';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
export async function loadAllRelationships(db: Firestore) {
  const local = await localDocuments(db,'company_relationships');
  return local ? {docs:local as QueryDocumentSnapshot[]} : db.collection('company_relationships').get();
}
export async function loadPublishedRelationships(db: Firestore) {
  return {docs:(await loadAllRelationships(db)).docs.filter(doc => doc.data().status === 'PUBLISHED')};
}
/** Untagged historical relationships retain their AI placement. Explicit decisions are authoritative. */
export function relationshipBelongsToTheme(row: Record<string, unknown>, theme: string) {
  return Array.isArray(row.themeIds) ? row.themeIds.includes(theme) : theme === 'ai';
}
export async function loadThemeRelationships(db: Firestore, theme: string) {
  return {docs:(await loadAllRelationships(db)).docs.filter(doc => (doc.data().themeIds ?? []).includes(theme))};
}
export async function loadCompanyRelationships(db: Firestore, companyIds: readonly string[], exactIds: readonly string[] = []) {
  const companies = new Set(companyIds), exact = new Set(exactIds);
  return {docs:(await loadAllRelationships(db)).docs.filter(doc => {const row=doc.data(); return exact.has(doc.id)||companies.has(row.source)||companies.has(row.target);})};
}
export async function loadFilingRelationships(db: Firestore, prefix: string, limit = 100) {
  const lower=Buffer.from(prefix), upper=Buffer.from(prefix+'\uf8ff');
  return {docs:(await loadAllRelationships(db)).docs.filter(doc => Buffer.compare(Buffer.from(doc.id),lower)>=0 && Buffer.compare(Buffer.from(doc.id),upper)<0)
    .sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(0,limit)};
}
