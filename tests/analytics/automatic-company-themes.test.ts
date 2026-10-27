import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import seed from '../../data/investment-themes/catalog-v1.json';
import {classifyOfficialThemes,officialThemeDomains,themeFields,themeVersion,type ThemeAssignment} from '../../src/lib/company-themes/classification';
import {catalogGraphSectors} from '../../src/lib/company-themes/catalog-graph';
import type {ThemedCompany} from '../../src/lib/company-themes/model';
import {LEGACY_THEME_BLOCK,canResumeAutomaticThemes} from '../../src/lib/instrument-onboarding/progress';
const catalog=seed.nodes,company={id:'US:TEST',name:'Test Company',status:'DIRECTORY',cik:'0000000123'};
const source={url:'https://www.sec.gov/Archives/edgar/data/123/report.htm',title:'Annual report',summary:'The company builds industrial robots and develops the AI computing systems that control them.'};
function assignment(theme:string):ThemeAssignment{const sector=catalogGraphSectors(catalog,theme)[0];return {theme,primarySector:sector.id,secondaryRoles:[],...(theme==='ai'?{aiStageIds:[sector.stages.find(id=>id.startsWith('ai.'))!]}:{}),sources:[source]};}
test('complete verified US and A-share evidence avoids search and preserves the same assignment',async()=>{
 const text='Official annual business and operating segments describe industrial robots. '.repeat(30),now=new Date().toISOString();
 for(const input of [{company,issuer:'sec:0000000123',url:source.url},{company:{id:'XSHG:688981',name:'Test CN',status:'DIRECTORY'},issuer:'cn:688981',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF'}]){
  const result={companyId:input.company.id,description:'Builds industrial robots.',assignments:[{...assignment('robotics'),sources:[{...source,url:input.url}]}]};
  const verifiedAnnual={companyId:input.company.id,issuerId:input.issuer,documentId:'1',latestAnnualId:'1',url:input.url,text,textSha256:createHash('sha256').update(text).digest('hex'),fullText:true,filedAt:now.slice(0,10),indexCheckedAt:now,laterMaterialChanges:false};
  let calls=0;const fetcher:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));if(calls===1)assert.equal(body.tools,undefined);else assert.equal(body.tool_choice,'required');return Response.json({status:'completed',output:[...(calls===1?[]:[{type:'web_search_call',action:{sources:[{url:input.url}]}}]),{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});};
  assert.deepEqual(await classifyOfficialThemes(input.company,catalog,{key:'fixture',verifiedAnnual,fetcher}),result);
  assert.deepEqual(await classifyOfficialThemes(input.company,catalog,{key:'fixture',fetcher}),result);
  assert.equal(calls,2);
 }
});
test('evidence-only no-match falls back to the official search path exactly once',async()=>{
 const text='Official annual business descriptions of industrial equipment. '.repeat(25),now=new Date().toISOString();
 const verifiedAnnual={companyId:company.id,issuerId:'sec:0000000123',documentId:'1',latestAnnualId:'1',url:source.url,text,textSha256:createHash('sha256').update(text).digest('hex'),fullText:true,filedAt:now.slice(0,10),indexCheckedAt:now,laterMaterialChanges:false};
 const empty={companyId:company.id,description:'Industrial equipment.',assignments:[]},matched={...empty,assignments:[assignment('robotics')]};let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.tools===undefined,calls===1);return Response.json({status:'completed',output:[...(calls===1?[]:[{type:'web_search_call',action:{sources:[{url:source.url}]}}]),{type:'message',content:[{type:'output_text',text:JSON.stringify(calls===1?empty:matched)}]}]});};
 assert.deepEqual(await classifyOfficialThemes(company,catalog,{key:'fixture',verifiedAnnual,fetcher}),matched);assert.equal(calls,2);
});
test('only old missing-theme blockers resume automatically; identity and financial failures stay untouched',()=>{
 const request={status:'BLOCKED',lastError:LEGACY_THEME_BLOCK,steps:{identity:'COMPLETE' as const}};
 assert(canResumeAutomaticThemes(request));assert(!canResumeAutomaticThemes({...request,lastError:'prices: failed'}));assert(!canResumeAutomaticThemes({...request,steps:{}}));assert(!canResumeAutomaticThemes({...request,steps:{identity:'COMPLETE',themes:'COMPLETE'}}));assert(!canResumeAutomaticThemes({...request,status:'SUPPORTED'}));
});
test('automatic classification publishes multiple existing themes and description without a review state',()=>{
 const fields=themeFields(company,catalog,[assignment('ai'),assignment('robotics')],'Builds robots and AI infrastructure.');
 assert.deepEqual(fields.themeIds,['ai','robotics']);assert.equal((fields.themeMemberships as Record<string,{status:string}>).ai.status,'PUBLISHED');assert.equal(fields.description,'Builds robots and AI infrastructure.');
});
test('automatic results preserve existing and withdrawn admin decisions',()=>{
 const existing:ThemedCompany={...company,...themeFields(company,catalog,[assignment('robotics')],'Existing description.')};
 existing.themeMemberships!.space={...assignment('space'),status:'WITHDRAWN',reviewedAt:'2026-01-01'};
 const fields=themeFields(existing,catalog,[assignment('space'),assignment('ai')],'Replacement description');
 assert.equal((fields.themeMemberships as Record<string,{status:string}>).space.status,'WITHDRAWN');assert.equal(fields.description,undefined);assert((fields.themeIds as string[]).includes('robotics'));
});
test('admin replacements withdraw removed themes and legacy AI placement, preserving unrelated data',()=>{
 const existing={...company,...themeFields(company,catalog,[assignment('ai'),assignment('robotics')],'Description.'),unrelated:'retain'};
 const fields=themeFields(existing,catalog,[assignment('space')],'Description.',true);
 assert.deepEqual(fields.themeIds,['space']);assert.equal((fields.inGraph as {status:string}).status,'WITHDRAWN');assert.equal((fields.themeMemberships as Record<string,{status:string}>).ai.status,'WITHDRAWN');assert(!('unrelated'in fields));
 assert.throws(()=>themeFields(existing,catalog,[],'',true),/At least one/);
});
test('evidence-only corrections retain granular placements; explicit placement changes replace them',()=>{
 const a=assignment('robotics');const existing:ThemedCompany={...company,...themeFields(company,catalog,[a],'Description.')};
 const granular=[{nodeId:'robotics.robot-manufacturers.industrial',status:'PUBLISHED' as const}];existing.themeMemberships!.robotics.assignments=granular;
 const fields=themeFields(existing,catalog,[{...a,sources:[{...source,summary:'Corrected evidence.'}]}],'',true);
 assert.deepEqual((fields.themeMemberships as ThemedCompany['themeMemberships'])!.robotics.assignments,granular);
 const other=catalogGraphSectors(catalog,'robotics').find(s=>s.id!==a.primarySector)!;
 const changed=themeFields(existing,catalog,[{...a,primarySector:other.id}],'',true);
 assert.equal((changed.themeMemberships as ThemedCompany['themeMemberships'])!.robotics.assignments,undefined);
});
test('invalid sectors, duplicate themes, and invalid source URLs never publish',()=>{
 assert.throws(()=>themeFields(company,catalog,[{...assignment('ai'),primarySector:'made-up'}],'Description'));
 assert.throws(()=>themeFields(company,catalog,[assignment('robotics'),assignment('robotics')],'Description'));
 assert.throws(()=>themeFields(company,catalog,[{...assignment('robotics'),sources:[{...source,url:'javascript:alert(1)'}]}],'Description'));
 assert.notEqual(themeVersion(company),themeVersion({...company,themeMemberships:{}}));
});
test('only reviewed corporate websites extend the official domain list',()=>{
 assert(!officialThemeDomains({...company,website:'https://example.com'}).includes('example.com'));
 assert(officialThemeDomains({...company,profile:{website:{url:'https://example.com',sourceUrl:'https://example.com/about'}}}).includes('example.com'));
 assert(!officialThemeDomains({...company,profile:{website:{url:'http://localhost',sourceUrl:'https://example.com'}}}).includes('localhost'));
});
test('OpenAI call requires actual official search citations and is bounded',async()=>{
 let usage=0;const result={companyId:company.id,description:'Builds industrial robots.',assignments:[assignment('robotics')]};
 const fetcher:typeof fetch=async(url,init)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.max_tool_calls,2);assert.equal(body.text.format.strict,true);assert(body.tools[0].filters.allowed_domains.includes('sec.gov'));return Response.json({status:'completed',id:'test-response',model:'fixture',output:[{type:'web_search_call',action:{sources:[{url:source.url}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});};
 assert.equal((await classifyOfficialThemes(company,catalog,{key:'fixture',fetcher,recordUsage:async()=>{usage++;}})).assignments.length,1);assert.equal(usage,1);
 const unverified:typeof fetch=async()=>Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://news.example.com/article'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({...result,assignments:[{...assignment('robotics'),sources:[{...source,url:'https://news.example.com/article'}]}]})}]}]});
 await assert.rejects(classifyOfficialThemes(company,catalog,{key:'fixture',fetcher:unverified}),/unverified official/);
 await assert.rejects(classifyOfficialThemes(company,catalog,{key:'fixture',fetcher:async()=>Response.json({status:'incomplete',output:[]})}),/did not complete/);
});
test('source-backed empty classification is a valid one-call no-match result',async()=>{
 let calls=0,usage=0;const result={companyId:company.id,description:'Officially reported business outside the existing themes.',assignments:[]};
 const fetcher:typeof fetch=async()=>{calls++;return Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:source.url}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});};
 assert.deepEqual(await classifyOfficialThemes(company,catalog,{key:'fixture',fetcher,recordUsage:async()=>{usage++;}}),result);assert.equal(calls,1);assert.equal(usage,1);
 const wrongIssuer:typeof fetch=async()=>Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://www.sec.gov/Archives/edgar/data/999/report.htm'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
 await assert.rejects(classifyOfficialThemes(company,catalog,{key:'fixture',fetcher:wrongIssuer}),/Official company search evidence unavailable/);
});

test('dated official business excerpts reach the one classification call and authorize their citations',async()=>{
 let calls=0;
 const result={companyId:company.id,description:'Builds industrial robots.',assignments:[assignment('robotics')]};
 const evidence={url:source.url,title:'Annual business and segments',kind:'annual_business' as const,publishedAt:new Date().toISOString().slice(0,10),text:'Operating segments: Robotics manufactures industrial robots. '.repeat(10)};
 const fetcher:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
  assert.match(input.businessEvidence[0].text,/Robotics manufactures/);assert.match(body.instructions,/annual-report business/);assert.match(body.instructions,/A-share annual reports/);assert.match(body.instructions,/untrusted evidence/);assert.equal(body.max_tool_calls,2);assert.equal(body.tool_choice,'required');
  return Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://www.sec.gov/Archives/edgar/data/123/newer.htm'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
 };
 assert.deepEqual(await classifyOfficialThemes(company,catalog,{key:'fixture',fetcher,evidence:[evidence]}),result);assert.equal(calls,1);
 const bad={...evidence,url:source.url.replace('/123/','/999/')};
 await assert.rejects(classifyOfficialThemes(company,catalog,{key:'fixture',evidence:[bad],fetcher:async(_url,init)=>{
  assert.deepEqual(JSON.parse(JSON.parse(String(init?.body)).input).businessEvidence,[]);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...result,assignments:[{...assignment('robotics'),sources:[{...source,url:bad.url}]}]})}]}]});
 }}),/Official search evidence unavailable/);
});
