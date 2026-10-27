import {createHash} from 'node:crypto';
import type {ThemedCompany} from './model';
import {isOfficialBusinessUrl} from './business-evidence';

/** Maximum annual text that the evidence-only classifier will submit. */
export const MAX_CLASSIFICATION_EVIDENCE_CHARS=120_000;

/** In-memory attestation produced by an independently verified official index.
 * It is not a persisted Firestore field or evidence that a document is current. */
export type OfficialAnnualEvidence = {
  companyId:string; issuerId:string; documentId:string; latestAnnualId:string;
  url:string; text:string; textSha256:string; fullText:boolean;
  filedAt:string; indexCheckedAt:string; unresolvedDisclosures:boolean;
  supplemental?:{documentId:string;url:string;title:string;filedAt:string;text:string;textSha256:string}[];
};

/** Fail closed: only an identity-checked, complete document matched to a fresh
 * official index can be considered for a no-search classification. */
export function evidenceReadiness(company:ThemedCompany,doc:OfficialAnnualEvidence,now=Date.now()):boolean {
  const expectedIssuer=company.id.startsWith('US:') && /^\d{1,10}$/.test(String(company.cik??''))
    ? `sec:${String(company.cik).padStart(10,'0')}`
    : /^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(company.id) ? `cn:${company.id.split(':')[1]}` : '';
  const checked=Date.parse(doc.indexCheckedAt), filed=Date.parse(doc.filedAt);
  if(!expectedIssuer || doc.companyId!==company.id || doc.issuerId!==expectedIssuer || !doc.documentId || doc.documentId!==doc.latestAnnualId
    || doc.fullText!==true || doc.unresolvedDisclosures!==false || !Number.isFinite(checked) || checked>now || now-checked>24*60*60*1000
    || !Number.isFinite(filed) || filed>now || now-filed>550*86400_000 || !isOfficialBusinessUrl(company,doc.url)
    || typeof doc.text!=='string' || doc.text.trim().length<100 || doc.text.length>1_000_000 || !/^[a-f0-9]{64}$/.test(doc.textSha256))return false;
  if(createHash('sha256').update(doc.text,'utf8').digest('hex')!==doc.textSha256)return false;
  if(doc.supplemental!==undefined){
    if(!Array.isArray(doc.supplemental)||doc.supplemental.length>8)return false;
    const ids=new Set([doc.documentId]);
    for(const item of doc.supplemental){
      if(!item||!item.documentId||ids.has(item.documentId)||!isOfficialBusinessUrl(company,item.url)||!item.title||typeof item.text!=='string'||item.text.trim().length<100||item.text.length>1_000_000||!Number.isFinite(Date.parse(item.filedAt))||item.filedAt<doc.filedAt||Date.parse(item.filedAt)>now||createHash('sha256').update(item.text,'utf8').digest('hex')!==item.textSha256)return false;
      ids.add(item.documentId);
    }
  }
  return true;
}
