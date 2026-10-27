import type {Firestore} from 'firebase-admin/firestore';
import type {OfficialAnnualTransport} from './official-annual-loader';
import {secRequest} from '../sec-request';
import {createCnEarningsRequester,parseCnEarningsOrg,type CnEarningsRequestContext} from '../earnings/live-cn';
import {createEarningsDownloader,readBoundedEarningsBody,sharedEarningsRequestGate} from '../earnings/live-transport';
import type {EarningsCompany} from '../earnings/issuers';
import {htmlToEarningsText} from '../earnings/document';
import type {ThemedCompany} from './model';
import {cnDisclosureDay} from './disclosure-index';

function onboardingCnIdentity(company:ThemedCompany):EarningsCompany {
  const code=company.id.split(':')[1], names=company.names && typeof company.names==='object' ? Object.values(company.names as Record<string,unknown>) : [];
  const aliases=[company.name,...names,...(Array.isArray(company.aliases)?company.aliases:[])].filter((value):value is string=>typeof value==='string'&&value.trim().length>=2).map(value=>value.trim());
  if(!/^(?:XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(company.id)||!['DIRECTORY','PUBLISHED'].includes(String(company.status))||!aliases.length)throw Error('Unverified onboarding issuer');
  return {companyId:company.id,issuerId:`cn:${code}`,cik:null,name:aliases[0],aliases:[...new Set(aliases)],irHosts:[]};
}

/** Uses the existing shared provider gates; errors leave the search fallback intact. */
export function officialAnnualTransport(db:Firestore,now=Date.now()):OfficialAnnualTransport {
  const userAgent=process.env.SEC_USER_AGENT?.trim()||'YouAnalyst/1.0 (https://youanalyst.com)';
  const gate=sharedEarningsRequestGate(db);
  const requester=createCnEarningsRequester({beforeRequest:context=>gate.beforeRequest(context),onBlocked:block=>gate.onBlocked(block)});
  const post=(body:Record<string,string>,operation:CnEarningsRequestContext['operation'],companyId:string)=>({method:'POST',body:new URLSearchParams(body).toString(),operation,companyId});
  return {
    secIndex:async cik=>secRequest(`https://data.sec.gov/submissions/CIK${cik}.json`,{headers:{'user-agent':userAgent,accept:'application/json'},signal:AbortSignal.timeout(12_000)},async r=>JSON.parse((await readBoundedEarningsBody(r,4*1024*1024)).toString('utf8')),{cik,operation:'theme_official_index'}),
    secSubmission:async(company,annual)=>{
      const cik=String(company.cik),url=`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${annual.documentId.replaceAll('-','')}/${annual.documentId}.txt`;
      return secRequest(url,{headers:{'user-agent':userAgent,accept:'text/plain'},signal:AbortSignal.timeout(30_000)},async r=>(await readBoundedEarningsBody(r,20*1024*1024)).toString('utf8'),{cik,accession:annual.documentId,operation:'theme_official_submission'});
    },
    cnIndex:async company=>{
      const id=company.id,code=id.split(':')[1],identity=onboardingCnIdentity(company),orgId=parseCnEarningsOrg(id,await requester.request('https://www.cninfo.com.cn/new/information/topSearch/query',post({keyWord:code,maxNum:'10'},'cninfo_earnings_org',id)),identity);
      const from=cnDisclosureDay(now-550*86400_000),to=cnDisclosureDay(now),pages:unknown[]=[];
      for(let page=1;page<=20;page++){
        const value=await requester.request('https://www.cninfo.com.cn/new/hisAnnouncement/query',post({pageNum:String(page),pageSize:'30',column:id.startsWith('XSHG:')?'sse':'szse',tabName:'fulltext',plate:'',stock:`${code},${orgId}`,searchkey:'',secid:'',category:'',trade:'',seDate:`${from}~${to}`,sortName:'',sortType:'',isHLtitle:'true'},'cninfo_earnings_announcements',id));
        if(!value||typeof value!=='object'||!Array.isArray((value as {announcements?:unknown}).announcements)||typeof (value as {hasMore?:unknown}).hasMore!=='boolean')throw Error('Invalid official disclosure index');
        pages.push(value);if(!(value as {hasMore:boolean}).hasMore)return {orgId,pages};
      }
      return null;
    },
    documentText:async(company,annual)=>{
      if(company.id.startsWith('US:'))return secRequest(annual.url,{headers:{'user-agent':userAgent,accept:'text/html,application/xhtml+xml,text/plain'},signal:AbortSignal.timeout(30_000)},async r=>htmlToEarningsText((await readBoundedEarningsBody(r)).toString('utf8')),{cik:String(company.cik),accession:annual.documentId,operation:'theme_official_annual'});
      const identity=onboardingCnIdentity(company),source={provider:'cninfo' as const,companyId:company.id,issuerId:identity.issuerId,documentId:annual.documentId,url:annual.url,title:'年度报告',publishedAt:{value:annual.filedAt,precision:'date' as const,timezone:'Asia/Shanghai'},firstSeenAt:new Date(now).toISOString(),language:'zh' as const};
      const downloaded=await createEarningsDownloader(db,{userAgent,verifiedIdentity:identity})(source),text=downloaded.pdfText;
      if(!text||!identity.aliases.some(alias=>text.slice(0,5000).includes(alias)))throw Error('Official annual document issuer mismatch');
      return text;
    },
  };
}
