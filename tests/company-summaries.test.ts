import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {publishSummaries,type SummaryBatch} from '../scripts/publish-company-summaries';
import {graphFromMarket} from '../src/lib/knowledge-graph/market-store';
import {themedGraph} from '../src/lib/company-themes/presentation';
import {companySummary,companySearchText} from '../src/lib/knowledge-graph/model';
const source='Process control and inspection for semiconductor manufacturing.';
const text='半导体制造用工艺控制与检测设备。';
const batch:SummaryBatch={asOf:'2026-10-08',summaries:[{id:'US:KLAC',theme:'ai',source,text}]};
const membership={status:'PUBLISHED' as const,stageIds:['equipment'],stages:[],memberships:[],sources:[],order:0,asOf:'2026-10-08'};
function fake(old:Record<string,unknown>){
 const writes:Record<string,unknown>[]=[];
 const db={collection:(name:string)=>{assert.equal(name,'companies');return {doc:(id:string)=>({id})};},runTransaction:async(fn:(tx:unknown)=>unknown)=>fn({getAll:async()=>[{data:()=>old}],update:(_ref:unknown,data:Record<string,unknown>)=>writes.push(data)})} as unknown as Firestore;
 return {db,writes};
}
test('Chinese summaries are projected from stored translations; English and stale-source fallback stay intact',()=>{
 const company={id:'US:KLAC',name:'KLA',status:'PUBLISHED',inGraph:membership,description:source,descriptionTranslations:{'zh-CN':{source,text}}};
 const graph=graphFromMarket([company],[]),node=graph.nodes[0];
 assert.equal(companySummary(node,'zh-CN'),text);
 assert.equal(companySummary(node,'en'),source);
 assert(companySearchText(graph,node).includes(text));
 assert.equal(companySummary(graphFromMarket([{...company,description:'Updated description'}],[]).nodes[0],'zh-CN'),'Updated description');
});
test('theme summaries use their own stored translations rather than another theme description',()=>{
 const graph=themedGraph('robotics',[{id:'US:KLAC',name:'KLA',status:'PUBLISHED',description:source,descriptionTranslations:{'zh-CN':{source,text}},themeMemberships:{robotics:{status:'PUBLISHED',primarySector:'sensors-vision',secondaryRoles:[],reviewedAt:'2026-10-08',sources:[{url:'https://example.com',title:'Robot vision',summary:'Robot vision.'}],summaryTranslations:{'zh-CN':{source:'Robot vision.',text:'机器人视觉。'}}}}}],[]);
 assert.equal(companySummary(graph.nodes.find(n=>n.kind==='COMPANY')!,'zh-CN'),'机器人视觉。');
});
test('publication previews without writes and changes only the localized field on existing records',async()=>{
 const f=fake({name:'KLA',status:'PUBLISHED',description:source});
 await publishSummaries(f.db,batch);assert.equal(f.writes.length,0);
 await publishSummaries(f.db,batch,true);
 assert.deepEqual(f.writes,[{'descriptionTranslations.zh-CN':{source,text,translatedAt:batch.asOf}}]);
});
test('changed source or conflicting stored translation rejects publication before writes',async()=>{
 for(const old of [{status:'PUBLISHED',description:'Changed'},{status:'PUBLISHED',description:source,descriptionTranslations:{'zh-CN':{source,text:'Different'}}}]){
  const f=fake(old);await assert.rejects(publishSummaries(f.db,batch,true));assert.equal(f.writes.length,0);
 }
});
import {publishSummariesRest} from '../scripts/publish-company-summaries';
import {encode,type Request} from '../scripts/migrate-company-themes';
test('REST publication atomically guards source revisions and masks only translated fields',async()=>{
 const requests:{url:string;data:unknown}[]=[];
 const request:Request=async(url,_method,data)=>{
  requests.push({url,data});
  if(url.endsWith(':batchGet'))return [{found:{name:'projects/test-project/databases/(default)/documents/companies/US:KLAC',fields:{status:encode('PUBLISHED'),description:encode(source)},updateTime:'2026-10-08T00:00:00Z'}}];
  return {};
 };
 await publishSummariesRest('test-project',batch,request,true);
 const commit=requests.find(r=>r.url.endsWith(':commit'))!.data as {writes:{updateMask:{fieldPaths:string[]};currentDocument:{updateTime:string};update:{fields:unknown}}[]};
 assert.equal(commit.writes.length,1);
 assert.deepEqual(commit.writes[0].updateMask.fieldPaths,['descriptionTranslations.`zh-CN`']);
 assert.equal(commit.writes[0].currentDocument.updateTime,'2026-10-08T00:00:00Z');
 assert.deepEqual(commit.writes[0].update.fields,{descriptionTranslations:encode({'zh-CN':{source,text,translatedAt:batch.asOf}})});
});
