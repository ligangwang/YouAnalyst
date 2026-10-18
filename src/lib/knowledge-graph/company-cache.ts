import type { Firestore } from 'firebase-admin/firestore';
import { changeCached } from '../change-cache';
import { COMPANY_THEMES } from '../company-themes/model';

/** Reuse enrollment records across graph rebuilds until company data changes. */
export function loadThemeEnrolledCompanies(db: Firestore) {
  return changeCached(db, 'theme-enrolled-companies', ['companies'], () =>
    db.collection('companies').where('themeIds', 'array-contains-any', [...COMPANY_THEMES]).get());
}
