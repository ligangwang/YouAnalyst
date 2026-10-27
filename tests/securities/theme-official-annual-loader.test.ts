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
test('loads every bounded later A-share disclosure or falls back without partial evidence',async()=>{
  const t=transport();
  t.cnIndex=async()=>({orgId:'gshk0000981',pages:[{announcements:[
    {secCode:'688981',orgId:'gshk0000981',announcementId:'100',adjunctUrl:'finalpage/2026-03-01/100.PDF',announcementTitle:'2025年年度报告'},
    {secCode:'688981',orgId:'gshk0000981',announcementId:'101',adjunctUrl:'finalpage/2026-04-01/101.PDF',announcementTitle:'后续公告'}
  ],hasMore:false,totalAnnouncement:2}]});
  t.documentText=async(_company,item)=>item.documentId==='100'?`第三节 管理层讨论与分析\n${body}第四节 公司治理`:'Later company disclosure with complete text. '.repeat(5);
  const evidence=await loadOfficialAnnual(cn,t,now);
  assert.equal(evidence?.supplemental?.length,1);
  assert.equal(evidence?.supplemental?.[0].documentId,'101');
  t.documentText=async(_company,item)=>item.documentId==='100'?`第三节 管理层讨论与分析\n${body}第四节 公司治理`:'详见附件 '+body;
  assert.equal(await loadOfficialAnnual(cn,t,now),null);
});
test('resolves an incorporated SEC annual report only from the matching complete submission',async()=>{
  const t=transport();
  t.documentText=async()=>`Item 1. Business\nThe annual report to stockholders is incorporated by reference.\n${body}Item 1A. Risk Factors`;
  const report='<DOCUMENT>\n<TYPE>EX-13\n<FILENAME>annual.htm\n<TEXT><html>'+body+'</html></TEXT>\n</DOCUMENT>';
  t.secSubmission=async()=>`ACCESSION NUMBER: 0000051143-26-000001\nCENTRAL INDEX KEY: 0000051143\n${report}\n</SEC-DOCUMENT>`;
  const evidence=await loadOfficialAnnual(us,t,now);
  assert.equal(evidence?.supplemental?.[0].documentId,'0000051143-26-000001:ex13');
  t.secSubmission=async()=>`ACCESSION NUMBER: 0000051143-26-000002\nCENTRAL INDEX KEY: 0000051143\n${report}\n</SEC-DOCUMENT>`;
  assert.equal(await loadOfficialAnnual(us,t,now),null);
});
test('includes all later SEC filing documents, including exhibits',async()=>{
  const t=transport(),original=t.secIndex;
  t.secIndex=async cik=>{const x=await original(cik) as {cik:string;filings:{recent:{form:string[];accessionNumber:string[];filingDate:string[];primaryDocument:string[]}}};x.filings.recent.form.push('8-K');x.filings.recent.accessionNumber.push('0000051143-26-000002');x.filings.recent.filingDate.push('2026-04-01');x.filings.recent.primaryDocument.push('event.htm');return x;};
  const doc=(type:string,file:string)=>`<DOCUMENT>\n<TYPE>${type}\n<FILENAME>${file}\n<TEXT><html>${body}</html></TEXT>\n</DOCUMENT>`;
  t.secSubmission=async()=>`ACCESSION NUMBER: 0000051143-26-000002\nCENTRAL INDEX KEY: 0000051143\n${doc('8-K','event.htm')}${doc('EX-99.1','exhibit.htm')}\n</SEC-DOCUMENT>`;
  const evidence=await loadOfficialAnnual(us,t,now);
  assert.deepEqual(evidence?.supplemental?.map(item=>item.documentId),['0000051143-26-000002:event.htm','0000051143-26-000002:exhibit.htm']);
  t.secSubmission=async()=>`ACCESSION NUMBER: 0000051143-26-000002\nCENTRAL INDEX KEY: 0000051143\n${doc('8-K','event.htm')}${doc('EX-99.1','exhibit.pdf')}\n</SEC-DOCUMENT>`;
  assert.equal(await loadOfficialAnnual(us,t,now),null);
});
test('missing, stale, later or incomplete sources fail closed to search',async()=>{
  assert.equal(await loadOfficialAnnual(us,{...transport(),secIndex:async()=>{throw Error('offline');}},now),null);
  assert.equal(await loadOfficialAnnual(cn,{...transport(),cnIndex:async()=>null},now),null);
  assert.equal(await loadOfficialAnnual(us,{...transport(),documentText:async()=>`Item 1. Business\n${body}`},now),null);
  assert.equal(await loadOfficialAnnual(us,{...transport(),documentText:async()=>`Portions of the annual report are incorporated by reference into Parts I, II and IV.\nItem 1. Business\n${body}Item 1A. Risk Factors`},now),null);
  const t=transport(), original=t.secIndex;t.secIndex=async cik=>{const x=await original(cik) as {cik:string;filings:{recent:{form:string[];accessionNumber:string[];filingDate:string[];primaryDocument:string[]}}};x.filings.recent.form.push('8-K');x.filings.recent.accessionNumber.push('0000051143-26-000002');x.filings.recent.filingDate.push('2026-04-01');x.filings.recent.primaryDocument.push('event.htm');return x;};
  let decision='';assert.equal(await loadOfficialAnnual(us,t,now,value=>{decision=value;}),null);assert.equal(decision,'newer_disclosure');
});
