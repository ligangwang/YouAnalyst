import {createHash} from 'node:crypto';
import type {ThemedCompany} from './model';
import {completeAnnualSection} from './annual-section';
import {cnAnnualIndex,cnLaterDisclosures,secAnnualIndex,type IndexedAnnual,type IndexedDisclosure} from './disclosure-index';
import {evidenceReadiness,MAX_CLASSIFICATION_EVIDENCE_CHARS,type OfficialAnnualEvidence} from './evidence-readiness';
import {secIncorporatedAnnual} from './sec-incorporated-report';

/** These adapters must read authoritative, complete issuer-specific indexes and
 * full documents. The no-search path fails closed when either is unavailable. */
export type OfficialAnnualTransport={
  secIndex:(cik:string)=>Promise<unknown>;
  cnIndex:(company:ThemedCompany)=>Promise<{orgId:string;pages:unknown[]}|null>;
  documentText:(company:ThemedCompany,annual:IndexedAnnual)=>Promise<string>;
  secSubmission?:(company:ThemedCompany,annual:IndexedAnnual)=>Promise<string>;
};
export type OfficialAnnualDecision='eligible'|'unsupported_issuer'|'index_unavailable'|'newer_disclosure'|'unresolved_reference'|'incomplete_section'|'invalid_evidence'|'source_error';

export async function loadOfficialAnnual(company:ThemedCompany,transport:OfficialAnnualTransport,now=Date.now(),report?:(decision:OfficialAnnualDecision)=>void):Promise<OfficialAnnualEvidence|null>{
  const fallback=(decision:OfficialAnnualDecision)=>{report?.(decision);return null;};
  try{
    let annual:IndexedAnnual|null=null,issuerId='',market:'US'|'CN_A',later:IndexedDisclosure[]=[];
    if(company.id.startsWith('US:') && /^\d{1,10}$/.test(String(company.cik??'')) && Number(company.cik)>0){
      const cik=String(company.cik).padStart(10,'0');
      issuerId=`sec:${cik}`;market='US';annual=secAnnualIndex(cik,await transport.secIndex(cik));
    }else if(/^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(company.id)){
      const code=company.id.split(':')[1], index=await transport.cnIndex(company);
      if(!index)return fallback('index_unavailable');
      issuerId=`cn:${code}`;market='CN_A';annual=cnAnnualIndex(code,index.orgId,index.pages);
      const documents=cnLaterDisclosures(code,index.orgId,index.pages);
      if(!documents)return fallback('newer_disclosure');
      later=documents;
    }else return fallback('unsupported_issuer');
    // US later filings still require exhibit resolution; fail closed until it
    // is possible to validate their complete attachments as well.
    if(!annual)return fallback('index_unavailable');
    if(annual.laterDisclosures && market==='US')return fallback('newer_disclosure');
    const document=await transport.documentText(company,annual);
    // A report may incorporate its business discussion from a separate filing.
    // Until those referenced documents are resolved, section boundaries alone
    // are not evidence that the issuer's business narrative is complete.
    const text=completeAnnualSection(document,market);
    if(!text)return fallback('incomplete_section');
    const supplemental:NonNullable<OfficialAnnualEvidence['supplemental']>=[];
    let total=text.length;
    if(market==='US' && (/incorporated\s+by\s+reference\s+into\s+parts?\s+i\b/i.test(document)||/incorporated\s+(?:herein\s+)?by\s+reference/i.test(text))){
      // Only the explicit annual-report incorporation is supported. Other
      // references must fall back until their targets can be independently resolved.
      const references=[...text.matchAll(/incorporated\s+(?:herein\s+)?by\s+reference/gi)];
      if(!references.length||references.some(match=>!/annual report to (?:stockholders|shareholders)/i.test(text.slice(Math.max(0,match.index!-350),match.index!)))||!transport.secSubmission)return fallback('unresolved_reference');
      const report=secIncorporatedAnnual(await transport.secSubmission(company,annual),String(company.cik),annual);
      if(!report)return fallback('unresolved_reference');
      total+=report.text.length;
      if(total>MAX_CLASSIFICATION_EVIDENCE_CHARS)return fallback('incomplete_section');
      supplemental.push({documentId:`${annual.documentId}:ex13`,filedAt:annual.filedAt,url:report.url,title:'Incorporated annual report to stockholders',text:report.text,textSha256:createHash('sha256').update(report.text,'utf8').digest('hex')});
    }
    for(const item of later){
      const full=await transport.documentText(company,{...item,laterDisclosures:false});
      // Separate attachments cannot be silently omitted from a disclosure.
      if(typeof full!=='string'||full.trim().length<100||/详见附件|见附件|附件\s*[：:]/.test(full))return fallback('unresolved_reference');
      total+=full.length;
      if(total>MAX_CLASSIFICATION_EVIDENCE_CHARS)return fallback('incomplete_section');
      supplemental.push({...item,text:full,textSha256:createHash('sha256').update(full,'utf8').digest('hex')});
    }
    const evidence:OfficialAnnualEvidence={companyId:company.id,issuerId,documentId:annual.documentId,latestAnnualId:annual.documentId,
      url:annual.url,text,textSha256:createHash('sha256').update(text,'utf8').digest('hex'),fullText:true,filedAt:annual.filedAt,
      indexCheckedAt:new Date(now).toISOString(),unresolvedDisclosures:false,...(supplemental.length?{supplemental}:{})};
    if(!evidenceReadiness(company,evidence,now))return fallback('invalid_evidence');
    report?.('eligible');return evidence;
  }catch{return fallback('source_error');}
}
