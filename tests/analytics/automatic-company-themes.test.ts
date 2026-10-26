import assert from 'node:assert/strict';
import test from 'node:test';
import seed from '../../data/investment-themes/catalog-v1.json';
import {classifyOfficialThemes,officialThemeDomains,themeFields,themeVersion,type ThemeAssignment} from '../../src/lib/company-themes/classification';
import {catalogGraphSectors} from '../../src/lib/company-themes/catalog-graph';
import type {ThemedCompany} from '../../src/lib/company-themes/model';
import {LEGACY_THEME_BLOCK,canResumeAutomaticThemes} from '../../src/lib/instrument-onboarding/progress';
const catalog=seed.nodes,company={id:'US:TEST',name:'Test Company',status:'DIRECTORY',cik:'0000000123'};
const source={url:'https://www.sec.gov/Archives/edgar/data/123/report.htm',title:'Annual report',summary:'The company builds industrial robots and develops the AI computing systems that control them.'};
function assignment(theme:string):ThemeAssignment{const sector=catalogGraphSectors(catalog,theme)[0];return {theme,primarySector:sector.id,secondaryRoles:[],...(theme==='ai'?{aiStageIds:[sector.stages.find(id=>id.startsWith('ai.'))!]}:{}),sources:[source]};}
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
