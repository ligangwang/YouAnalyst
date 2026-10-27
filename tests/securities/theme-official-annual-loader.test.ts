import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOfficialAnnual,type OfficialAnnualTransport} from '../../src/lib/company-themes/official-annual-loader';
const now=Date.parse('2026-10-27T12:00:00Z'),body='Official business activities and operating segments.\n'.repeat(30);
const us={id:'US:IBM',cik:'0000051143'},cn={id:'XSHG:688981'};
function transport():OfficialAnnualTransport{return {
  secIndex:async()=>({cik:'51143',filings:{recent:{form:['10-K'],accessionNumber:['0000051143-26-000001'],filingDate:['2026-03-01'],primaryDocument:['annual.htm']}}}),
  cnIndex:async()=>({orgId:'gshk0000981',pages:[{announcements:[{secCode:'688981',orgId:'gshk0000981',announcementId:'100',adjunctUrl:'finalpage/2026-03-01/100.PDF',announcementTitle:'2025年年度报告'}],hasMore:false,totalAnnouncement:1}]}),
  documentText:async company=>company.id.startsWith('US:')?`Item 1. Business\n${body}Item 1A. Risk Factors`:`第三节 管理层讨论与分析\n${body}第四节 公司治理`,
};}
test('loads complete, independently indexed US and A-share annual sections',async()=>{
  for(const company of [us,cn]){const value=await loadOfficialAnnual(company,transport(),now);assert(value);assert.match(value.text,/operating segments/);}
});
test('missing, stale, later or incomplete sources fail closed to search',async()=>{
  assert.equal(await loadOfficialAnnual(us,{...transport(),secIndex:async()=>{throw Error('offline');}},now),null);
  assert.equal(await loadOfficialAnnual(cn,{...transport(),cnIndex:async()=>null},now),null);
  assert.equal(await loadOfficialAnnual(us,{...transport(),documentText:async()=>`Item 1. Business\n${body}`},now),null);
  assert.equal(await loadOfficialAnnual(us,{...transport(),documentText:async()=>`Portions of the annual report are incorporated by reference into Parts I, II and IV.\nItem 1. Business\n${body}Item 1A. Risk Factors`},now),null);
  const t=transport(), original=t.secIndex;t.secIndex=async cik=>{const x=await original(cik) as {cik:string;filings:{recent:{form:string[];accessionNumber:string[];filingDate:string[];primaryDocument:string[]}}};x.filings.recent.form.push('8-K');x.filings.recent.accessionNumber.push('0000051143-26-000002');x.filings.recent.filingDate.push('2026-04-01');x.filings.recent.primaryDocument.push('event.htm');return x;};
  assert.equal(await loadOfficialAnnual(us,t,now),null);
});
