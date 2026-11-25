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
import { companySector, graphSectors } from '../src/lib/knowledge-graph/sectors';
import { industryTree, industryRootLabel } from '../src/lib/ui/knowledge-graph/industry-tree';
import { firestoreSource } from '../src/lib/central-cache/source';
import { isCollectionCompany, collectionUniverse } from '../src/lib/company-themes/model';
import { localDocuments } from '../src/lib/local-cache/entities';
import { closeLocalCaches } from '../src/lib/local-cache/watch';
import {loadThemeCoverage} from '../src/lib/company-themes/coverage';

const catalog=validateThemeCatalog(seed.nodes);

test('article publication covers every published theme, deduplicates companies and bounds graph reads',async()=>{
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

test('the released catalog keeps existing subscriptions stable',async(t)=>{
  t.after(closeLocalCaches);let clock=1000;
  t.mock.method(Date,'now',()=>clock);
  const subscriptions:{closed:boolean}[]=[];
  const companyQuery={where:()=>companyQuery,onSnapshot:(next:(snapshot:unknown)=>void)=>{const item={closed:false};subscriptions.push(item);next({docs:[]});return ()=>{item.closed=true;};}};
  const db={collection:(name:string)=>{assert.equal(name,'companies');return companyQuery;}} as unknown as Firestore;
  await localDocuments(db,'companies');
  clock+=60_001;
  await localDocuments(db,'companies');
  assert.equal(subscriptions.length,1);assert.equal(subscriptions.filter(item=>!item.closed).length,1);
});
test('theme resolution uses published catalog ordering, not a fixed default or arbitrary identifiers',()=>{
  const nodes=catalog.filter(node=>!['ai','robotics','space'].some(id=>node.id===id||node.id.startsWith(id+'.')));
  assert.equal(resolveCatalogTheme(nodes,undefined),'cybersecurity');
  assert.equal(resolveCatalogTheme(nodes,'quantum-computing'),'quantum-computing');
  assert.equal(resolveCatalogTheme(nodes,'ai'),undefined);
  assert.equal(resolveCatalogTheme(nodes,'transformative-technologies'),undefined);
  assert.equal(resolveCatalogTheme(nodes,'../ai'),undefined);
});

test('company cache scope uses the same release catalog after restart',async(t)=>{
  let clock=1000;
  t.mock.method(Date,'now',()=>clock);
  const companies=[{id:'US:AI',themeIds:['ai'],updatedAt:0},{id:'US:FUSION',themeIds:['fusion'],updatedAt:0}];
  type Filter={field:string;op:string;value:unknown};
  function query(collection:string,filters:Filter[]=[]) {
    const q={where:(field:string,op:string,value:unknown)=>query(collection,[...filters,{field,op,value}]),orderBy:()=>q,select:()=>q,limit:()=>q,
      get:async()=>({docs:(collection==='companies'?companies:[]).filter(row=>filters.every(filter=>{
        const value=(row as Record<string,unknown>)[filter.field];
        if(filter.op==='array-contains-any')return (filter.value as string[]).some(id=>(value as string[]).includes(id));
        if(filter.field==='updatedAt')return filter.op==='>='?Number(value)>=(filter.value as {seconds:number}).seconds:Number(value)<=(filter.value as {seconds:number}).seconds;
        return value===filter.value;
      })).map(row=>({id:row.id,data:()=>row})),size:companies.length})};return q;
  }
  const db={collection:(name:string)=>{assert(['companies','collectors'].includes(name));return query(name);},getAll:async()=>[]} as unknown as Firestore;
  const source=firestoreSource(db);
  assert.deepEqual((await source.initial('companies',[])).map(row=>row.id),['US:AI']);
  clock+=60_001;
  const rows=await source.changes('companies',{seconds:1,nanoseconds:0},{seconds:2,nanoseconds:0},[]);
  assert.deepEqual(rows.map(row=>row.id),[]);
  const restarted=firestoreSource(db);
  assert.deepEqual((await restarted.initial('companies',[])).map(row=>row.id),['US:AI']);
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

test('the runtime catalog matches the reviewed release data without Firestore',async()=>{
  const released=await loadThemeCatalog();
  assert.deepEqual(released,catalog.map(({id,parentId,names,order,descriptions})=>({id,parentId,names,order,...(descriptions?{descriptions}:{})})));
  assert.equal(await loadThemeCatalog(),released);
});

test('company queries chunk catalogs larger than 30 themes and deduplicate cross-theme companies',async()=>{
  const themes=Array.from({length:65},(_,index)=>({id:`theme-${index}`,parentId:'family',names:{en:`Theme ${index}`,'zh-CN':`主题${index}`},order:index}));
  const nodes=[{id:'family',parentId:null,names:{en:'Family','zh-CN':'大类'},order:0},...themes];
  const batches:string[][]=[];
  const db={collection:()=>({where:(_key:string,_op:string,ids:string[])=>({get:async()=>{batches.push(ids);return {docs:[{id:'US:COMMON'},{id:`US:${ids[0]}`}]};}})})} as unknown as Firestore;
  const result=await queryThemeCompanies(db,undefined,false,nodes);
  assert.deepEqual(batches.map(batch=>batch.length),[30,30,5]);assert.equal(result.docs.length,4);
  assert.deepEqual(new Set(batches.flat()),new Set(themes.map(theme=>theme.id)));
});

test('every family, theme and AI layer has a nonempty English and Chinese description',()=>{
  const described=catalog.filter(node=>hierarchyPath(catalog,node.id).length<=2||node.parentId==='ai');
  assert.equal(described.length,25);
  for(const node of described){assert.ok(node.descriptions?.en.trim());assert.ok(node.descriptions?.['zh-CN'].trim());}
  assert.throws(()=>validateThemeCatalog([{...catalog[0],descriptions:{en:'English only','zh-CN':''}},...catalog.slice(1)]),/Invalid hierarchy node/);
});
