import type {DocumentData} from 'firebase-admin/firestore';

/** Derived file only: full documents and search keep the authoritative snapshot. */
export const COMPANY_VIEW_OBJECT='entity-snapshots/companies-view.sqlite';
export const isCompanyViewField=(field:string)=>!['searchPrefixes','searchTerms'].includes(field.split('.')[0]);
export function companyViewData(data:DocumentData):DocumentData {
 return Object.fromEntries(Object.keys(data).filter(isCompanyViewField).map(key=>[key,data[key]]));
}
