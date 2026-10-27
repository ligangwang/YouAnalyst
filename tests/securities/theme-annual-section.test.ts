import test from 'node:test';
import assert from 'node:assert/strict';
import {completeAnnualSection} from '../../src/lib/company-themes/annual-section';

test('requires actual start and end boundaries for US and Chinese annual reports',()=>{
  const cases=[
    {market:'US' as const,start:'Item 1. Business',end:'Item 1A. Risk Factors'},
    {market:'CN_A' as const,start:'第三节 管理层讨论与分析',end:'第四节 公司治理'},
  ];
  for(const {market,start,end} of cases){
    const body='Business segment and products are described in this section.\n'.repeat(30);
    assert.equal(completeAnnualSection(`${start}\n${body}${end}\n`,market),`${start}\n${body}`.trim());
    assert.equal(completeAnnualSection(`${start}\n${body}`,market),null);
    assert.equal(completeAnnualSection(`${start}\ncontents\n${end}`,market),null);
    assert.equal(completeAnnualSection(`${start}\n${body}${end}\n${start}\n${body}${end}`,market),null);
  }
});
