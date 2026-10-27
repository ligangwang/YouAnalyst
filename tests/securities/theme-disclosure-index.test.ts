import test from 'node:test';
import assert from 'node:assert/strict';
import {cnAnnualIndex,cnDisclosureDay,secAnnualIndex} from '../../src/lib/company-themes/disclosure-index';

test('CN index window includes the current Shanghai day across UTC midnight',()=>{
  assert.equal(cnDisclosureDay(Date.parse('2026-10-27T17:00:00Z')),'2026-10-28');
});

test('SEC index verifies issuer, complete columns and subsequent disclosures',()=>{
  const recent={form:['10-K','8-K'],accessionNumber:['0000051143-26-000001','0000051143-26-000002'],filingDate:['2026-02-01','2026-03-01'],primaryDocument:['annual.htm','event.htm']};
  const payload={cik:'0000051143',filings:{recent}};
  assert.deepEqual(secAnnualIndex('51143',payload),{documentId:'0000051143-26-000001',filedAt:'2026-02-01',url:'https://www.sec.gov/Archives/edgar/data/51143/000005114326000001/annual.htm',laterDisclosures:true});
  assert.equal(secAnnualIndex('999',payload),null);
  assert.equal(secAnnualIndex('51143',{...payload,filings:{recent:{...recent,filingDate:['2026-02-01']}}}),null);
});

test('CN index requires all pages and validates every issuer and document',()=>{
  const annual={secCode:'688981',orgId:'gshk0000981',announcementId:'100',adjunctUrl:'finalpage/2026-04-01/100.PDF',announcementTitle:'2025年年度报告'};
  const event={...annual,announcementId:'101',adjunctUrl:'finalpage/2026-05-01/101.PDF',announcementTitle:'重要公告'};
  const pages=[{announcements:[annual],hasMore:true,totalAnnouncement:2},{announcements:[event],hasMore:false,totalAnnouncement:2}];
  assert.deepEqual(cnAnnualIndex('688981','gshk0000981',pages),{documentId:'100',filedAt:'2026-04-01',url:'https://static.cninfo.com.cn/finalpage/2026-04-01/100.PDF',laterDisclosures:true});
  assert.equal(cnAnnualIndex('688981','gshk0000981',pages.slice(0,1)),null);
  assert.equal(cnAnnualIndex('688981','gshk0000981',[pages[0],{...pages[1],announcements:[{...event,secCode:'600519'}]}]),null);
  assert.equal(cnAnnualIndex('688981','gshk0000981',[{announcements:[{...annual,announcementTitle:'2025年半年度报告'}],hasMore:false,totalAnnouncement:1}]),null);
});
