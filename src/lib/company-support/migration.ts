import {isCollectionCompany, type ThemedCompany} from '../company-themes/model';
import {isSupportedCompany} from './model';

/** Grandfather existing coverage, without claiming fresh backfills or user requests. */
export function planSupportedMigration(records: ThemedCompany[], allowedThemes: readonly string[]) {
  const ids = new Set<string>();
  return records.filter(company => {
    if (ids.has(company.id)) throw new Error(`Duplicate company: ${company.id}`);
    ids.add(company.id);
    if (company.isDeleted === true || !isCollectionCompany(company, allowedThemes)) return false;
    if (isSupportedCompany(company)) return false;
    if (company.onboarding !== undefined) throw new Error(`${company.id}: existing onboarding state conflicts`);
    return true;
  }).map(company => company.id).sort();
}
