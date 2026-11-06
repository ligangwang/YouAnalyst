import test from 'node:test';
import assert from 'node:assert/strict';
import seed from '../../data/investment-themes/catalog-v1.json';
import {classifyOfficialThemes,themeFields} from '../../src/lib/company-themes/classification';
import {closestThemeAssignments,secIssuerProfile,storedCompanyContext} from '../../src/lib/company-themes/closest-policy';
import {catalogGraphSectors} from '../../src/lib/company-themes/catalog-graph';
import {officialSourceUrl,secSourceMatchesIssuer} from '../../src/lib/company-themes/source-url';
const catalog=seed.nodes,company={id:'US:TEST',name:'Test Company',status:'DIRECTORY',cik:'0000000123'};
const url='https://data.sec.gov/submissions/CIK0000000123.json';
const source={url,title:'SEC issuer profile',summary:'The SEC classifies this company as an industrial equipment business; robotics is the closest available theme.'};

test('closest onboarding requires at least one theme in one schema-constrained provider call',async()=>{
  const profile=secIssuerProfile(company,{cik:123,name:'Test Company',sicDescription:'Industrial machinery'});assert(profile);
  const sector=catalogGraphSectors(catalog,'robotics')[0],result={companyId:company.id,description:'Industrial machinery company.',assignments:[{theme:'robotics',primarySector:sector.id,secondaryRoles:[sector.id,sector.id],aiStageIds:[],sources:[source]}]};let calls=0;
  const fetcher:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.text.format.schema.properties.assignments.minItems,1);assert.equal(body.tools,undefined);assert.match(body.instructions,/AT LEAST ONE/);assert.match(body.input,/Industrial machinery/);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});};
  const value=await classifyOfficialThemes(company,catalog,{key:'fixture',closestMatch:true,verifiedIssuerProfile:profile,fetcher});
  assert.equal(calls,1);assert.equal(value.assignments.length,1);assert.deepEqual(value.assignments[0].secondaryRoles,[]);assert.doesNotThrow(()=>themeFields(company,catalog,value.assignments,value.description));
  const empty:typeof fetch=async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...result,assignments:[]})}]}]});};
  await assert.rejects(()=>classifyOfficialThemes(company,catalog,{key:'fixture',closestMatch:true,verifiedIssuerProfile:profile,fetcher:empty}),/closest existing theme/);assert.equal(calls,2);
});
test('closest AI placement repairs duplicate or off-sector stages with a broad valid selected stage',()=>{
  const [primary,other]=catalogGraphSectors(catalog,'ai');
  const value=closestThemeAssignments([{theme:'ai',primarySector:primary.id,secondaryRoles:[primary.id],aiStageIds:[other.stages.find(id=>catalog.some(node=>node.id===id))!],sources:[source]}],catalog);
  assert(value[0].aiStageIds!.length);assert(value[0].aiStageIds!.every(id=>primary.stages.includes(id)));assert.doesNotThrow(()=>themeFields(company,catalog,value,'Industrial company.'));
});
test('SEC canonicalization accepts the same issuer document through an iXBRL wrapper, never another issuer',()=>{
  const wrapped='https://www.sec.gov/ix?doc=%2FArchives%2Fedgar%2Fdata%2F0000123%2Freport.htm&utm_source=search';
  assert.equal(officialSourceUrl(wrapped),'https://www.sec.gov/Archives/edgar/data/0000123/report.htm');assert(secSourceMatchesIssuer(wrapped,123));assert(!secSourceMatchesIssuer(wrapped,999));
  assert.throws(()=>officialSourceUrl('https://www.sec.gov/ix?doc=https://example.com/Archives/edgar/data/123/report.htm'));
  assert.equal(secIssuerProfile(company,{cik:999,name:'Wrong issuer',sicDescription:'Industrial machinery'}),undefined);
});

test('closest onboarding still selects a theme without external evidence and labels the directory fit honestly',async()=>{
  const context=storedCompanyContext(company),sector=catalogGraphSectors(catalog,'robotics')[0];let calls=0;
  const result={companyId:company.id,description:'Test Company is listed in the company directory.',assignments:[{theme:'robotics',primarySector:sector.id,secondaryRoles:[],aiStageIds:[],sources:[{url:context.url,title:context.title,summary:'The broadest closest available category for the current directory context.'}]}]};
  const fetcher:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.tools,undefined);assert.equal(body.text.format.schema.properties.assignments.minItems,1);assert.equal(JSON.parse(body.input).businessEvidence[0].kind,'company_profile');assert.deepEqual(body.text.format.schema.$defs.evidenceUrl.enum,[context.url]);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});};
  const value=await classifyOfficialThemes(company,catalog,{key:'fixture',closestMatch:true,fetcher});assert.equal(calls,1);assert.equal(value.assignments.length,1);assert.match(value.assignments[0].sources[0].summary,/Approximate closest-theme fit/);
  const other:typeof fetch=async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...result,assignments:[{...result.assignments[0],sources:[{...result.assignments[0].sources[0],url:context.url+'-other-company'}]}]})}]}]});
  await assert.rejects(()=>classifyOfficialThemes(company,catalog,{key:'fixture',closestMatch:true,fetcher:other}),/unverified official source/);
});
