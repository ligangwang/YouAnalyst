import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evidenceReadiness,type OfficialAnnualEvidence} from '../../src/lib/company-themes/evidence-readiness';

const now=Date.parse('2026-10-27T12:00:00Z');
const text='Official annual business and operating segments. '.repeat(20);
const base={text,textSha256:createHash('sha256').update(text).digest('hex'),fullText:true,filedAt:'2026-03-01',indexCheckedAt:'2026-10-27T11:00:00Z',unresolvedDisclosures:false,documentId:'annual-1',latestAnnualId:'annual-1'};
test('requires complete, fresh and identity-matched annual evidence for US and A-share issuers',()=>{
  const cases=[
    {company:{id:'US:IBM',cik:'0000051143'},doc:{...base,companyId:'US:IBM',issuerId:'sec:0000051143',url:'https://www.sec.gov/Archives/edgar/data/51143/report.htm'}},
    {company:{id:'XSHG:600519'},doc:{...base,companyId:'XSHG:600519',issuerId:'cn:600519',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF'}},
  ];
  for(const {company,doc} of cases){
    assert(evidenceReadiness(company,doc,now));
    for(const change of [{fullText:false},{issuerId:'other'},{latestAnnualId:'newer'},{unresolvedDisclosures:true},{indexCheckedAt:'2026-10-25T00:00:00Z'},{textSha256:'0'.repeat(64)}])
      assert.equal(evidenceReadiness(company,{...doc,...change} as OfficialAnnualEvidence,now),false);
  }
});

test('later disclosures must be intact, unique and from an official source',()=>{
  const company={id:'XSHG:600519'};
  const laterText='Official disclosure. '.repeat(10);
  const later={documentId:'later-1',url:'https://static.cninfo.com.cn/finalpage/2026-04-01/later.PDF',title:'Later disclosure',filedAt:'2026-04-01',text:laterText,textSha256:createHash('sha256').update(laterText).digest('hex')};
  const doc={...base,companyId:company.id,issuerId:'cn:600519',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',supplemental:[later]};
  assert(evidenceReadiness(company,doc,now));
  assert(!evidenceReadiness(company,{...doc,supplemental:[{...later,text:'Changed '+laterText}]},now));
  assert(!evidenceReadiness(company,{...doc,supplemental:[later,later]},now));
  assert(!evidenceReadiness(company,{...doc,supplemental:[{...later,url:'https://other.example/later.PDF'}]},now));
});
