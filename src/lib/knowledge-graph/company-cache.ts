import { localDocuments } from '../local-cache/entities';
import type { Firestore } from 'firebase-admin/firestore';
import { queryThemeCompanies } from '../company-themes/company-query';
export async function loadThemeEnrolledCompanies(db: Firestore) {
  const local = await localDocuments(db, 'companies');
  return local ? {docs:local} : queryThemeCompanies(db);
}
