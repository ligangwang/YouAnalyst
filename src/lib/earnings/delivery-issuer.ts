import type {Firestore} from 'firebase-admin/firestore';
import {readSecCollectionCompany} from '../company-support/collection-reader';
import {isSupportedCompany, supportedCompanyUniverse} from '../company-support/model';
import {earningsCompany, withEarningsIssuerScope} from './issuers';
import {loadEarningsMap} from './map-issuers';

/** Recheck enrollment with a field-mask read; only this delivery's verified SEC
 * identity needs a subscription. No full company or collector directory load. */
export async function withDeliveryIssuer<T>(db: Firestore, companyId: string, work: () => Promise<T>): Promise<T> {
  if (!/^(?:US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(companyId)) throw new Error('Invalid earnings company');
  return withEarningsIssuerScope(async () => {
    const company = await readSecCollectionCompany(db, companyId);
    if (!company || !isSupportedCompany(company)) throw new Error('Earnings company is not supported');
    await loadEarningsMap(db, supportedCompanyUniverse([company]));
    earningsCompany(companyId); // Reject missing/mismatched identities before work.
    return work();
  });
}
