import { localDocuments } from '../local-cache/entities';
import type { Firestore } from 'firebase-admin/firestore';
import { COMPANY_THEMES } from '../company-themes/model';
export async function loadThemeEnrolledCompanies(db: Firestore) {
  const local = await localDocuments(db, 'companies');
  return local ? {docs:local} : db.collection('companies').where('themeIds','array-contains-any',[...COMPANY_THEMES]).get();
}
