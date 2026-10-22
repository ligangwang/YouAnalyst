import test from 'node:test';
import assert from 'node:assert/strict';
import {companyName,companySearchText,matchesCompanySearch,type GraphNode} from '../../src/lib/knowledge-graph/model';

test('Chinese reference names fill English placeholders while preserving identity and edited names',()=>{
  const company:GraphNode={id:'US:ALAB',kind:'COMPANY',order:0,name:'Astera Labs',names:{en:'Astera Labs','zh-CN':'Astera Labs'}};
  assert.equal(companyName(company,'zh-CN'),'阿斯特拉实验室（Astera Labs）');
  assert.equal(companyName(company,'en'),'Astera Labs');
  assert.equal(companyName({...company,names:{'zh-CN':'管理员中文名'}},'zh-CN'),'管理员中文名');
  assert.equal(companyName({...company,names:undefined},'zh-CN'),'阿斯特拉实验室（Astera Labs）');
  assert.equal(companyName({...company,id:'US:UNKNOWN'},'zh-CN'),'Astera Labs');
  const search=companySearchText({nodes:[company],relationships:[],sources:[],asOf:''},company);
  for(const query of ['阿斯特拉','Astera','ALAB'])assert(matchesCompanySearch(search,query));
  assert.equal(company.names?.['zh-CN'],'Astera Labs');
});
