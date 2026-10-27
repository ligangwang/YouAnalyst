import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evidenceReadiness,type OfficialAnnualEvidence} from '../../src/lib/company-themes/evidence-readiness';

const now=Date.parse('2026-10-27T12:00:00Z');
const text='Official annual business and operating segments. '.repeat(20);
const base={text,textSha256:createHash('sha256').update(text).digest('hex'),fullText:true,filedAt:'2026-03-01',indexCheckedAt:'2026-10-27T11:00:00Z',laterMaterialChanges:false,documentId:'annual-1',latestAnnualId:'annual-1'};
test('requires complete, fresh and identity-matched annual evidence for US and A-share issuers',()=>{
  const cases=[
    {company:{id:'US:IBM',cik:'0000051143'},doc:{...base,companyId:'US:IBM',issuerId:'sec:0000051143',url:'https://www.sec.gov/Archives/edgar/data/51143/report.htm'}},
    {company:{id:'XSHG:600519'},doc:{...base,companyId:'XSHG:600519',issuerId:'cn:600519',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF'}},
  ];
  for(const {company,doc} of cases){
    assert(evidenceReadiness(company,doc,now));
    for(const change of [{fullText:false},{issuerId:'other'},{latestAnnualId:'newer'},{laterMaterialChanges:true},{indexCheckedAt:'2026-10-25T00:00:00Z'},{textSha256:'0'.repeat(64)}])
      assert.equal(evidenceReadiness(company,{...doc,...change} as OfficialAnnualEvidence,now),false);
  }
});
