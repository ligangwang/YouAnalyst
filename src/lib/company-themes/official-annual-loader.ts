import {createHash} from 'node:crypto';
import type {ThemedCompany} from './model';
import {completeAnnualSection} from './annual-section';
import {cnAnnualIndex,secAnnualIndex,type IndexedAnnual} from './disclosure-index';
import {evidenceReadiness,type OfficialAnnualEvidence} from './evidence-readiness';

/** These adapters must read authoritative, complete issuer-specific indexes and
 * full documents. The no-search path fails closed when either is unavailable. */
export type OfficialAnnualTransport={
  secIndex:(cik:string)=>Promise<unknown>;
  cnIndex:(company:ThemedCompany)=>Promise<{orgId:string;pages:unknown[]}|null>;
  documentText:(company:ThemedCompany,annual:IndexedAnnual)=>Promise<string>;
};

export async function loadOfficialAnnual(company:ThemedCompany,transport:OfficialAnnualTransport,now=Date.now()):Promise<OfficialAnnualEvidence|null>{
  try{
    let annual:IndexedAnnual|null=null,issuerId='',market:'US'|'CN_A';
    if(company.id.startsWith('US:') && /^\d{1,10}$/.test(String(company.cik??'')) && Number(company.cik)>0){
      const cik=String(company.cik).padStart(10,'0');
      issuerId=`sec:${cik}`;market='US';annual=secAnnualIndex(cik,await transport.secIndex(cik));
    }else if(/^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(company.id)){
      const code=company.id.split(':')[1], index=await transport.cnIndex(company);
      if(!index)return null;
      issuerId=`cn:${code}`;market='CN_A';annual=cnAnnualIndex(code,index.orgId,index.pages);
    }else return null;
    // Never read a document when the index already indicates newer material.
    if(!annual||annual.laterDisclosures)return null;
    const document=await transport.documentText(company,annual);
    // A report may incorporate its business discussion from a separate filing.
    // Until those referenced documents are resolved, section boundaries alone
    // are not evidence that the issuer's business narrative is complete.
    if(market==='US' && /incorporated\s+by\s+reference\s+into\s+parts?\s+i\b/i.test(document))return null;
    const text=completeAnnualSection(document,market);
    if(!text)return null;
    if(/incorporated\s+by\s+reference/i.test(text))return null;
    const evidence:OfficialAnnualEvidence={companyId:company.id,issuerId,documentId:annual.documentId,latestAnnualId:annual.documentId,
      url:annual.url,text,textSha256:createHash('sha256').update(text,'utf8').digest('hex'),fullText:true,filedAt:annual.filedAt,
      indexCheckedAt:new Date(now).toISOString(),laterMaterialChanges:false};
    return evidenceReadiness(company,evidence,now)?evidence:null;
  }catch{return null;}
}
