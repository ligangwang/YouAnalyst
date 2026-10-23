import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import seed from '../data/investment-themes/catalog-v1.json';
import { catalogThemeIds, themeFamilies, validateThemeCatalog, descendantThemeIds, resolveCatalogTheme, type ThemeCatalog } from '../src/lib/company-themes/catalog-model';
import { loadThemeCatalog } from '../src/lib/company-themes/catalog';
import { applyThemeCatalog } from '../src/lib/company-themes/catalog-graph';
import { themedGraph } from '../src/lib/company-themes/presentation';
import { queryThemeCompanies } from '../src/lib/company-themes/company-query';
import { companyThemeNodeIds } from '../src/lib/hierarchy/company-memberships';
import { hierarchyPath } from '../src/lib/hierarchy/model';
import { planThemeCatalog, publishInvestmentThemes } from '../scripts/publish-investment-themes';
import { company, encode, type Document } from '../scripts/lib/firestore-rest';
import { companySector, graphSectors } from '../src/lib/knowledge-graph/sectors';
import { industryTree, industryRootLabel } from '../src/lib/ui/knowledge-graph/industry-tree';
import { withThemeCatalog } from './helpers/theme-catalog';
import { firestoreSource } from '../src/lib/central-cache/source';
import { isCollectionCompany, collectionUniverse } from '../src/lib/company-themes/model';
import { localDocuments } from '../src/lib/local-cache/entities';
import { closeLocalCaches } from '../src/lib/local-cache/watch';
import {loadThemeCoverage} from '../src/lib/company-themes/coverage';

const catalog=validateThemeCatalog(seed.nodes);

test('article publication covers every Firestore theme, deduplicates companies and bounds graph reads',async()=>{
  let active=0,maxActive=0;
  const calls:string[]=[];
  const graph=await loadThemeCoverage(async()=>catalog,async theme=>{
    calls.push(theme);active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setImmediate(resolve));active--;
    return {nodes:[{id:'US:COMMON',kind:'COMPANY',order:0},{id:`US:${theme.toUpperCase()}`,kind:'COMPANY',order:1}],sources:[],relationships:[],asOf:''};
  });
  assert.deepEqual(calls,catalogThemeIds(catalog));
  assert.ok(calls.includes('biotechnology'));assert.ok(maxActive<=4);
  assert.equal(graph.nodes.filter(node=>node.id==='US:COMMON').length,1);
  assert.equal(graph.nodes.length,calls.length+1);
});

test('the existing five AI layers fit below family and theme while preserving role links and recorded memberships',()=>{
  const layers=['energy','chips','infrastructure','models','applications'];
  assert.deepEqual(catalog.filter(node=>node.parentId==='ai').map(node=>node.id),layers.map(id=>'ai.'+id));
  for(const id of layers)assert.deepEqual(hierarchyPath(catalog,'ai.'+id).map(node=>node.id),['transformative-technologies','ai','ai.'+id]);
  const nodes=['energy','compute','servers','models','edge'].map((stage,index)=>({id:`US:ROLE${index}`,kind:'COMPANY' as const,order:index,stageIds:[stage]}));
  const before=structuredClone(nodes);
  const projected=applyThemeCatalog({nodes,sources:[],relationships:[],asOf:''},'ai',catalog);
  const tree=industryTree(projected.nodes);
  assert.deepEqual(tree.map(layer=>layer.id),layers);
  assert.ok(tree.find(layer=>layer.id==='chips')!.branches.some(branch=>branch.id==='chips/compute'));
  for(const node of nodes){
    assert.deepEqual(projected.nodes.find(item=>item.id===node.id)!.stageIds,node.stageIds);
    assert.ok(tree.some(layer=>layer.companies.some(item=>item.id===node.id)));
  }
  assert.deepEqual(nodes,before);
  const sparse=industryTree(applyThemeCatalog({nodes:[nodes[1]],sources:[],relationships:[],asOf:''},'ai',catalog).nodes);
  assert.deepEqual(sparse.map(layer=>layer.id),layers);
  assert.equal(sparse.find(layer=>layer.id==='models')!.companies.length,0);
});
test('a retired theme stops collection without deleting or altering its memberships',()=>{
  const company={id:'US:OLD',name:'Old member',status:'DIRECTORY',inGraph:{status:'PUBLISHED'},themeMemberships:{ai:{status:'PUBLISHED' as const,primarySector:'compute',reviewedAt:'2026-10-22'}}};
  const before=structuredClone(company);
  assert.equal(isCollectionCompany(company,['fusion']),false);
  assert.equal(isCollectionCompany(company,['ai']),true);
  assert.equal(collectionUniverse({nodes:[{id:company.id,kind:'COMPANY',order:0}],relationships:[],sources:[],asOf:''},[company],['fusion']).nodes.length,0);
  assert.deepEqual(company,before);
});

test('mixed broad and detailed AI roles remain visible in the data-driven tree',()=>{
  const graph=applyThemeCatalog({nodes:[{id:'US:APP',kind:'COMPANY',order:0,stageIds:['applications']},{id:'US:EDGE',kind:'COMPANY',order:1,stageIds:['edge']},{id:'US:NEIGHBOR',kind:'COMPANY',order:2,stageIds:['related']}],sources:[],relationships:[],asOf:''},'ai',catalog);
  const layers=industryTree(graph.nodes);
  assert.deepEqual(new Set(layers.flatMap(layer=>layer.directCompanies?layer.companies:layer.branches.flatMap(branch=>branch.companies)).map(company=>company.id)),new Set(['US:APP','US:EDGE','US:NEIGHBOR']));
  assert.deepEqual(graphSectors('unreviewed-empty-theme'),[]);
});

test('catalog changes replace obsolete company subscriptions instead of accumulating listeners',async(t)=>{
  t.after(closeLocalCaches);let clock=1000;
  t.mock.method(Date,'now',()=>clock);
  const nodes:ThemeCatalog=[{id:'family',parentId:null,names:{en:'Family','zh-CN':'大类'},order:0},{id:'ai',parentId:'family',names:{en:'AI','zh-CN':'人工智能'},order:0}];
  const subscriptions:{closed:boolean}[]=[];
  const catalogQuery={where:()=>catalogQuery,select:()=>catalogQuery,limit:()=>catalogQuery,get:async()=>({docs:nodes.map(node=>({id:node.id,data:()=>node}))})};
  const companyQuery={where:()=>companyQuery,onSnapshot:(next:(snapshot:unknown)=>void)=>{const item={closed:false};subscriptions.push(item);next({docs:[]});return ()=>{item.closed=true;};}};
  const db={collection:(name:string)=>name==='investment_themes'?catalogQuery:companyQuery} as unknown as Firestore;
  await localDocuments(db,'companies');
  nodes.push({id:'fusion',parentId:'family',names:{en:'Fusion','zh-CN':'聚变'},order:1});clock+=60_001;
  await localDocuments(db,'companies');
  assert.equal(subscriptions.length,2);assert.equal(subscriptions.filter(item=>!item.closed).length,1);
});
test('theme resolution uses published catalog ordering, not a fixed default or arbitrary identifiers',()=>{
  const nodes=catalog.filter(node=>!['ai','robotics','space'].some(id=>node.id===id||node.id.startsWith(id+'.')));
  assert.equal(resolveCatalogTheme(nodes,undefined),'cybersecurity');
  assert.equal(resolveCatalogTheme(nodes,'quantum-computing'),'quantum-computing');
  assert.equal(resolveCatalogTheme(nodes,'ai'),undefined);
  assert.equal(resolveCatalogTheme(nodes,'transformative-technologies'),undefined);
  assert.equal(resolveCatalogTheme(nodes,'../ai'),undefined);
});

test('central cache discovers unchanged companies when a new theme is published',async(t)=>{
  let clock=1000;
  t.mock.method(Date,'now',()=>clock);
  const definitions:ThemeCatalog=[{id:'family',parentId:null,names:{en:'Family','zh-CN':'大类'},order:0},{id:'ai',parentId:'family',names:{en:'AI','zh-CN':'人工智能'},order:0}];
  const companies=[{id:'US:AI',themeIds:['ai'],updatedAt:0},{id:'US:FUSION',themeIds:['fusion'],updatedAt:0}];
  type Filter={field:string;op:string;value:unknown};
  function query(collection:string,filters:Filter[]=[]) {
    const q={where:(field:string,op:string,value:unknown)=>query(collection,[...filters,{field,op,value}]),orderBy:()=>q,select:()=>q,limit:()=>q,
      get:async()=>({docs:(collection==='investment_themes'?definitions.map(node=>({...node,status:'PUBLISHED'})):collection==='companies'?companies:[]).filter(row=>filters.every(filter=>{
        const value=(row as Record<string,unknown>)[filter.field];
        if(filter.op==='array-contains-any')return (filter.value as string[]).some(id=>(value as string[]).includes(id));
        if(filter.field==='updatedAt')return filter.op==='>='?Number(value)>=(filter.value as {seconds:number}).seconds:Number(value)<=(filter.value as {seconds:number}).seconds;
        return value===filter.value;
      })).map(row=>({id:row.id,data:()=>row})),size:companies.length})};return q;
  }
  const db={collection:(name:string)=>query(name),getAll:async()=>[]} as unknown as Firestore;
  const source=firestoreSource(db);
  assert.deepEqual((await source.initial('companies',[])).map(row=>row.id),['US:AI']);
  definitions.push({id:'fusion',parentId:'family',names:{en:'Fusion','zh-CN':'聚变'},order:1});clock+=60_001;
  const rows=await source.changes('companies',{seconds:1,nanoseconds:0},{seconds:2,nanoseconds:0},[]);
  assert.deepEqual(rows.map(row=>row.id),['US:FUSION']);
});
test('four families preserve every legacy ID and aggregate existing memberships without company writes',()=>{
  assert.equal(themeFamilies(catalog).length,4);
  assert.deepEqual(descendantThemeIds(catalog,'transformative-technologies'),['ai','robotics','space','cybersecurity','quantum-computing']);
  const member={status:'PUBLISHED',primarySector:'compute-control',secondaryRoles:['software-simulation'],sources:[{url:'https://example.com',title:'Original evidence',summary:'Reviewed business.'}],reviewedAt:'2026-10-22'};
  const company={themeMemberships:{robotics:member,space:{...member,primarySector:'launch'}}};
  const original=structuredClone(company);
  const ids=companyThemeNodeIds(company,catalog);
  assert(ids.includes('robotics.compute-control'));assert(ids.includes('space.launch'));
  assert(hierarchyPath(catalog,ids[0]).some(node=>node.id==='transformative-technologies'));
  assert.deepEqual(company,original);
});

test('a new theme and its nested business roles render from data without source allowlists',()=>{
  const extra:ThemeCatalog=[...catalog,{id:'fusion',parentId:'environment-resources',names:{en:'Fusion Energy','zh-CN':'聚变能源'},order:10},{id:'fusion.magnets',parentId:'fusion',names:{en:'Magnets','zh-CN':'磁体'},order:0}];
  const membership={status:'PUBLISHED' as const,primarySector:'magnets',reviewedAt:'2026-10-22',sources:[{url:'https://example.com',title:'Magnets',summary:'Builds fusion magnets.'}]};
  const companies=[{id:'US:NEW',name:'New company',status:'DIRECTORY',themeMemberships:{fusion:membership}}];
  const before=structuredClone(companies);
  const graph=applyThemeCatalog(themedGraph('fusion',companies,[],extra),'fusion',extra);
  const node=graph.nodes.find(node=>node.kind==='COMPANY')!;
  assert.equal(companySector(node).en,'Magnets');assert.equal(companySector(node).zh,'磁体');
  assert.equal(graphSectors('fusion',[node]).length,1);
  assert.equal(industryRootLabel(industryTree([node]),'zh-CN'),'聚变能源 产业');
  assert.deepEqual(companies,before);
});

test('catalog reads are coalesced, refresh without deployment and retain the last valid tree on invalid updates',async(t)=>{
  let reads=0,clock=1000,nodes:ThemeCatalog=catalog;
  t.mock.method(Date,'now',()=>clock);
  const query={where:()=>query,select:()=>query,limit:()=>query,get:async()=>{reads++;return {docs:nodes.map(node=>({id:node.id,data:()=>node}))};}};
  const db={collection:()=>query} as unknown as Firestore;
  const results=await Promise.all([loadThemeCatalog(db),loadThemeCatalog(db)]);assert.equal(reads,1);assert.equal(results[0],results[1]);
  nodes=[...catalog,{id:'fusion',parentId:'environment-resources',names:{en:'Fusion','zh-CN':'聚变'},order:10}];clock+=60_001;
  assert(catalogThemeIds(await loadThemeCatalog(db)).includes('fusion'));assert.equal(reads,2);
  nodes=[{...nodes[0],parentId:'missing'}];clock+=60_001;
  t.mock.method(console,'error',()=>{});
  assert(catalogThemeIds(await loadThemeCatalog(db)).includes('fusion'));assert.equal(reads,3);
  const cold={collection:()=>query} as unknown as Firestore;
  await assert.rejects(loadThemeCatalog(cold),/Missing hierarchy parent/);
});

test('company queries chunk catalogs larger than 30 themes and deduplicate cross-theme companies',async()=>{
  const themes=Array.from({length:65},(_,index)=>({id:`theme-${index}`,parentId:'family',names:{en:`Theme ${index}`,'zh-CN':`主题${index}`},order:index}));
  const nodes=[{id:'family',parentId:null,names:{en:'Family','zh-CN':'大类'},order:0},...themes];
  const batches:string[][]=[];
  const db=withThemeCatalog({collection:()=>({where:(_key:string,_op:string,ids:string[])=>({get:async()=>{batches.push(ids);return {docs:[{id:'US:COMMON'},{id:`US:${ids[0]}`}]};}})})} as unknown as Firestore,nodes as typeof seed.nodes);
  const result=await queryThemeCompanies(db);
  assert.deepEqual(batches.map(batch=>batch.length),[30,30,5]);assert.equal(result.docs.length,4);
  assert.deepEqual(new Set(batches.flat()),new Set(themes.map(theme=>theme.id)));
});

test('catalog publication is additive, fenced, atomic and idempotent; never writes companies',async()=>{
  const originals:Document[]=['ai','robotics','space'].map((id,index)=>({name:`projects/example/databases/(default)/documents/investment_themes/${id}`,updateTime:'2026-10-22T00:00:00Z',fields:Object.fromEntries(Object.entries({parentId:null,names:{en:`Custom ${id}`,'zh-CN':`定制${id}`},order:index,status:'PUBLISHED'}).map(([key,value])=>[key,encode(value)]))}));
  originals[0].fields.descriptions=encode({en:'Existing reviewed description','zh-CN':'已有审核说明'});
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const backupDir=await mkdtemp(`${tmpdir()}/theme-catalog-`);
  let commits=0;
  try{
    const result=await publishInvestmentThemes({project:'example',seed:seed.nodes,write:true,backupDir,request:async(url,_method,raw)=>{
      if(url.endsWith(':runQuery'))return originals.map(document=>({document}));
      assert(url.endsWith(':commit'));commits++;
      for(const write of (raw as {writes:{update:Document;updateMask?:unknown;currentDocument:unknown}[]}).writes){
        assert(write.update.name.includes('/investment_themes/'));assert(!write.update.name.includes('/companies/'));
        const old=originals.find(doc=>doc.name===write.update.name);
        if(old){assert.deepEqual(write.currentDocument,{updateTime:old.updateTime});assert.deepEqual(Object.keys(write.update.fields),old.fields.descriptions?['parentId']:['parentId','descriptions']);Object.assign(old.fields,write.update.fields);}
        else {assert.deepEqual(write.currentDocument,{exists:false});originals.push(write.update);}
      }return {};
    }});
    assert.equal(commits,1);assert.equal(result.companyWrites,0);
    assert.equal(company(originals[0]).names && (company(originals[0]).names as {en:string}).en,'Custom ai');
    assert.deepEqual(company(originals[0]).descriptions,{en:'Existing reviewed description','zh-CN':'已有审核说明'});
    assert.ok((company(originals[1]).descriptions as {en:string;'zh-CN':string})['zh-CN']);
    assert.equal(planThemeCatalog(originals.map(company) as unknown as Parameters<typeof planThemeCatalog>[0],seed.nodes).length,0);
  }finally{await rm(backupDir,{recursive:true,force:true});}
});

test('every family, theme and AI layer has a nonempty English and Chinese description',()=>{
  const described=catalog.filter(node=>hierarchyPath(catalog,node.id).length<=2||node.parentId==='ai');
  assert.equal(described.length,25);
  for(const node of described){assert.ok(node.descriptions?.en.trim());assert.ok(node.descriptions?.['zh-CN'].trim());}
  assert.throws(()=>validateThemeCatalog([{...catalog[0],descriptions:{en:'English only','zh-CN':''}},...catalog.slice(1)]),/Invalid hierarchy node/);
});
