import {createHash} from 'node:crypto';
import type {ThemedCompany} from './model';
import {isOfficialBusinessUrl} from './business-evidence';

/** In-memory attestation produced by an independently verified official index.
 * It is not a persisted Firestore field or evidence that a document is current. */
export type OfficialAnnualEvidence = {
  companyId:string; issuerId:string; documentId:string; latestAnnualId:string;
  url:string; text:string; textSha256:string; fullText:boolean;
  filedAt:string; indexCheckedAt:string; laterMaterialChanges:boolean;
};

/** Fail closed: only an identity-checked, complete document matched to a fresh
 * official index can be considered for a no-search classification. */
export function evidenceReadiness(company:ThemedCompany,doc:OfficialAnnualEvidence,now=Date.now()):boolean {
  const expectedIssuer=company.id.startsWith('US:') && /^\d{1,10}$/.test(String(company.cik??''))
    ? `sec:${String(company.cik).padStart(10,'0')}`
    : /^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(company.id) ? `cn:${company.id.split(':')[1]}` : '';
  const checked=Date.parse(doc.indexCheckedAt), filed=Date.parse(doc.filedAt);
  if(!expectedIssuer || doc.companyId!==company.id || doc.issuerId!==expectedIssuer || !doc.documentId || doc.documentId!==doc.latestAnnualId
    || doc.fullText!==true || doc.laterMaterialChanges!==false || !Number.isFinite(checked) || checked>now || now-checked>24*60*60*1000
    || !Number.isFinite(filed) || filed>now || now-filed>550*86400_000 || !isOfficialBusinessUrl(company,doc.url)
    || typeof doc.text!=='string' || doc.text.trim().length<100 || doc.text.length>1_000_000 || !/^[a-f0-9]{64}$/.test(doc.textSha256))return false;
  return createHash('sha256').update(doc.text,'utf8').digest('hex')===doc.textSha256;
}
