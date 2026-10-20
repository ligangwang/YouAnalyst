import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeGraph } from '../src/lib/knowledge-graph/model';
import { activeThemeIds, collectionUniverse, isCollectionCompany, type ThemedCompany } from '../src/lib/company-themes/model';
import batch from '../data/robotics/company-memberships.json';
import { usMapTickers } from '../src/lib/knowledge-graph/us-companies';
import { cnMapCompanies } from '../src/lib/knowledge-graph/cn-companies';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCollectionCompanies, loadCollectionCompanyScope, loadCollectionUniverse, loadThemeCompanies } from '../src/lib/company-themes/service';
import spaceBatch from '../data/space/company-memberships.json';
import {planThemeEnrollment,validateThemeBatch} from '../src/lib/company-themes/migration';
import {themedGraph} from '../src/lib/company-themes/presentation';
import {themeMetadata} from '../src/lib/company-themes/metadata';
import {loadKnowledgeGraph} from '../src/lib/knowledge-graph/service';

test('collector company scope keeps names and theme enrollment without reading graph data',async()=>{
 const records=[
  {id:'US:AAA',name:'Company A',aliases:['Alias A'],names:{en:'Company A'},themeMemberships:{ai:{status:'PUBLISHED',primarySector:'compute'}}},
  {id:'XSHE:000063',name:'Company B',themeMemberships:{robotics:{status:'PUBLISHED',primarySector:'sensors'}}},
  {id:'ORG:PRIVATE',name:'Company C',themeMemberships:{space:{status:'PUBLISHED',primarySector:'launch'}}},
  {id:'US:WITHDRAWN',name:'Withdrawn',themeMemberships:{ai:{status:'WITHDRAWN'}}},
 ];
 let reads=0;
 const db={collection:(name:string)=>{
  assert.equal(name,'companies','collector scope must not read relationships or fundamentals');
  return {where:(field:string,op:string,values:string[])=>{
   assert.equal(field,'themeIds');assert.equal(op,'array-contains-any');
   assert.deepEqual(values,['ai','robotics','space']);
   return {get:async()=>{reads++;return {docs:records.map(row=>({id:row.id,data:()=>({...row,status:'DIRECTORY'})}))};}};
  }};
 }} as unknown as Firestore;
 const scope=await loadCollectionCompanyScope(db);
 assert.equal(reads,1);
 assert.deepEqual(scope.nodes.map(n=>n.id),['US:AAA','XSHE:000063','ORG:PRIVATE']);
 assert.deepEqual(scope.nodes[0].aliases,['Alias A']);
 assert.equal(scope.nodes[1].market,'CN_A');
 assert.deepEqual(scope.relationships,[]);
});

test('collection scope reuses one theme query without dropping graph neighbors or theme-only companies', async () => {
  const membership = {status:'PUBLISHED',stageIds:[],stages:[],memberships:[],sources:[],order:1,asOf:'2026-10-17'};
  const enrolled = [
    {id:'US:AAA',name:'Graph company',status:'PUBLISHED',inGraph:membership},
    {id:'US:CCC',name:'Theme-only company',status:'DIRECTORY',themeMemberships:{space:{status:'PUBLISHED',primarySector:'launch'}}},
    {id:'US:DDD',name:'Withdrawn company',status:'DIRECTORY',themeMemberships:{ai:{status:'WITHDRAWN'}}},
  ];
  const neighbor = {id:'US:BBB',name:'Related company',status:'DIRECTORY'};
  const edge = {id:'edge',source:'US:AAA',target:'US:BBB',type:'SUPPLIER_OF',status:'PUBLISHED',evidence:[{url:'https://example.com/report',title:'Report'}]};
  const snapshot = (row: Record<string, unknown>) => ({id:row.id,exists:true,data:()=>row});
  let themeReads=0;
  const db = {
    collection: (name:string) => ({
      get:async()=>{assert.equal(name,'company_relationships');return {docs:[snapshot(edge)]};},
      doc: (id:string) => ({name,id,get:async()=>snapshot({enabled:false})}),
      where: (field:string,operator:string,value:unknown) => ({get:async()=>{
        if(name==='companies') {
          assert.equal(field,'themeIds');assert.equal(operator,'array-contains-any');assert.deepEqual(value,['ai','robotics','space']);
          themeReads++;return {docs:enrolled.map(snapshot)};
        }
        assert.equal(name,'company_relationships');return {docs:[snapshot(edge)]};
      }}),
    }),
    getAll: async (...refs:Array<{name?:string;id?:string}>) => refs.filter(ref=>ref.id).map(ref=>snapshot(ref.name==='companies'?neighbor:{id:ref.id})),
  } as unknown as Firestore;
  const scope=await loadCollectionUniverse(db);
  assert.equal(themeReads,1);
  assert.deepEqual(usMapTickers(scope),['AAA','BBB','CCC']);
  assert.equal(scope.relationships.length,1);
  // Standalone graph callers still perform their own enrollment query.
  await loadKnowledgeGraph({db});
  assert.equal(themeReads,2);
});

test('Space enrollment preserves overlapping themes, drives job scopes and projects reviewed roles',()=>{
  validateThemeBatch(spaceBatch,'space');
  const oldMembership={status:'PUBLISHED' as const,primarySector:'compute',reviewedAt:'2026-01-01'};
  const rows=spaceBatch.companies.map(proposal=>({id:proposal.id,name:proposal.expectedName,status:'DIRECTORY',themeMemberships:{ai:oldMembership},themeIds:['ai']}));
  const before=structuredClone(rows),patches=planThemeEnrollment(rows,spaceBatch,'space');
  const after=rows.map(row=>({...row,...patches.find(patch=>patch.id===row.id)}));
  assert.deepEqual(rows,before);assert.equal(after.length,31);
  for(const row of after){assert.deepEqual(row.themeMemberships.ai,oldMembership);assert.deepEqual(row.themeIds,['ai','space']);}
  assert.equal(planThemeEnrollment(after,spaceBatch,'space').length,0);
  const union=collectionUniverse(ai,after);
  for(const proposal of spaceBatch.companies.filter(row=>row.id.startsWith('US:')))assert(usMapTickers(union).includes(proposal.id.slice(3)));
  for(const proposal of spaceBatch.companies.filter(row=>row.id.startsWith('XSHG:')))assert(cnMapCompanies(union).includes(proposal.id));
  const graph=themedGraph('space',after);
  assert.equal(graph.nodes.filter(node=>node.kind==='COMPANY').length,31);
  assert.equal(graph.relationships.length,0);
  assert(graph.sources.every(source=>source.sourceDate===null));
  const rocket=graph.nodes.find(node=>node.id==='US:RKLB')!;
  assert.deepEqual(rocket.stageIds,['space:launch','space:components','space:spacecraft']);
  assert.throws(()=>planThemeEnrollment([{...after[0],name:'Other company'},...after.slice(1)],spaceBatch,'space'),/identity changed/);
});

test('theme metadata identifies Space and Robotics URLs while preserving the AI default',()=>{
  assert.equal(themeMetadata('space').canonical,'/?theme=space');
  for (const theme of ['ai','robotics','space']) assert.equal(themeMetadata(theme).title,'YouAnalyst | Investment Intelligence. Reimagined.');
  assert.match(themeMetadata('robotics').description,/robotics companies/);
  assert.equal(themeMetadata(undefined).canonical,'/');
  assert.deepEqual(themeMetadata('invalid'),themeMetadata('ai'));
});

const ai: KnowledgeGraph = { nodes: Array.from({ length: 134 }, (_, i) => ({ id: i === 0 ? 'US:NVDA' : `US:AI${i}`, kind: 'COMPANY' as const, name: i === 0 ? batch.companies[0].expectedName : `Company ${i}`, order: i, stageIds: ['compute'] })),
  relationships: [{ id: 'published-contract', source: 'US:NVDA', target: 'US:AI1', type: 'SUPPLIER', summary: 'Reviewed relationship', sourceIds: ['original-source'], commercialStatus: 'SHIPPED' }],
  sources: [{ id: 'original-source', title: 'Original source', url: 'https://example.com/original', sourceDate: '2026-01-01' }], asOf: '2026-10-04' };
test('authoritative membership status controls job eligibility and future enrollment needs no ticker list', () => {
  const row: ThemedCompany = { id: 'US:NEW', name: 'New company', status: 'DIRECTORY', themeIds: ['robotics'], themeMemberships: { robotics: { status: 'PUBLISHED', primarySector: 'sensors-vision', reviewedAt: '2026-10-04' } } };
  assert(isCollectionCompany(row)); assert(usMapTickers(collectionUniverse(ai, [row])).includes('NEW'));
  row.themeMemberships!.robotics.status = 'WITHDRAWN'; assert(!isCollectionCompany(row)); assert.deepEqual(activeThemeIds(row), []);
  row.inGraph = { status: 'PUBLISHED' }; assert(isCollectionCompany(row));
  row.themeMemberships!.ai = { status: 'WITHDRAWN', primarySector: 'compute', reviewedAt: '2026-10-04' }; assert(!isCollectionCompany(row));
});

test('indexed theme reads reject stale array entries and combined enrollment deduplicates legacy records', async () => {
  const membership = { status: 'PUBLISHED', primarySector: 'compute-control', reviewedAt: '2026-10-04' };
  const rows = [
    { id: 'US:NVDA', name: 'NVIDIA', status: 'DIRECTORY', themeIds: ['ai', 'robotics'], themeMemberships: { ai: membership, robotics: membership }, inGraph: { status: 'PUBLISHED' } },
    { id: 'US:OLD', name: 'Withdrawn company', status: 'DIRECTORY', themeIds: ['robotics'], themeMemberships: { robotics: { ...membership, status: 'WITHDRAWN' } } },
    { id: 'US:HIDDEN', name: 'Hidden company', status: 'DRAFT', themeIds: ['robotics'], themeMemberships: { robotics: membership } },
  ];
  const db = { collection: (name: string) => { if(name==='collectors')return {doc:()=>({get:async()=>({data:()=>({enabled:false})})})}; assert.equal(name, 'companies'); return { where: (field: string, operator: string, value: string | string[]) => { assert.equal(field, 'themeIds'); return ({ get: async () => ({ docs: rows.filter(row => {
    if (field === 'themeIds') return operator === 'array-contains' ? row.themeIds.includes(String(value)) : row.themeIds.some(theme => value.includes(theme));
    return field === 'inGraph.status' && row.inGraph?.status === value;
  }).map(row => ({ id: row.id, data: () => row })) }) }); } }; } } as unknown as Firestore;
  assert.deepEqual((await loadThemeCompanies('robotics', db)).map(row => row.id), ['US:NVDA']);
  assert.deepEqual((await loadCollectionCompanies(db)).map(row => row.id), ['US:NVDA']);
});

test('withdrawn AI enrollment overrides legacy graph flags while neighbors and another published theme remain eligible', async () => {
  const record: ThemedCompany = { id: 'US:NVDA', name: 'NVIDIA', status: 'DIRECTORY', themeIds: [], inGraph: { status: 'PUBLISHED' }, themeMemberships: { ai: { status: 'WITHDRAWN', primarySector: 'compute', reviewedAt: '2026-10-04' } } };
  const db = { collection: () => ({ where: (field: string) => ({ get: async () => ({ docs: field === 'themeIds' ? [{ id: record.id, data: () => record }] : [] }) }) }) } as unknown as Firestore;
  const excluded = await loadCollectionUniverse(db, ai);
  assert(!usMapTickers(excluded).includes('NVDA'));
  assert.equal(excluded.nodes.filter(node => node.kind === 'COMPANY').length, 133);
  assert(excluded.nodes.some(node => node.id === 'US:AI1'), 'Relationship-only neighbor must survive');
  record.themeMemberships!.robotics = { status: 'PUBLISHED', primarySector: 'compute-control', reviewedAt: '2026-10-04' };
  record.themeIds = ['robotics'];
  assert(usMapTickers(await loadCollectionUniverse(db, ai)).includes('NVDA'));
});

test('theme presentation retains canonical identities and secondary roles without copying AI edges or publication dates',async()=>{
  const {roboticsGraph}=await import('../src/lib/company-themes/presentation');
  const {industryTree,industryRootLabel,layoutIndustryTree}=await import('../src/lib/ui/knowledge-graph/industry-tree');
  const {layoutVerticalTree}=await import('../src/lib/ui/knowledge-graph/vertical-tree');
  const {companySector,matchesCompanySector}=await import('../src/lib/knowledge-graph/sectors');
  const {parseCompanyTheme}=await import('../src/lib/company-themes/model');
  const member={status:'PUBLISHED' as const,primarySector:'compute-control',secondaryRoles:['software-simulation'],reviewedAt:'2026-10-04',sources:[{url:'https://www.nvidia.com/en-us/industries/robotics/',title:'Robotics',summary:'Platform'}]};
  const company={id:'US:NVDA',status:'PUBLISHED',name:'NVIDIA',symbol:'NVDA',themeMemberships:{robotics:member}};
  const other={...company,id:'US:ROK',name:'Rockwell',themeMemberships:{robotics:{...member,primarySector:'systems-integration',secondaryRoles:[]}}};
  const relationship={id:'edge',status:'PUBLISHED',source:company.id,target:other.id,type:'PARTNER_OF',evidence:[{id:'s',title:'Source',url:'https://www.nvidia.com/',sourceDate:'2026-10-01'}]};
  const graph=roboticsGraph([company,other,{...company,id:'US:HIDDEN',themeMemberships:{robotics:{...member,status:'DRAFT'}}}],[relationship]);
  assert.deepEqual(graph.nodes.filter(n=>n.kind==='COMPANY').map(n=>n.id).sort(),['US:NVDA','US:ROK']);
  assert.equal(graph.relationships.length,0);assert.equal(graph.sources[0].sourceDate,null);
  const nvda=graph.nodes.find(n=>n.id==='US:NVDA')!;assert.equal(companySector(nvda).id,'compute-control');
  assert.deepEqual(nvda.stageIds,['robotics:compute-control','robotics:software-simulation']);assert(matchesCompanySector(nvda,'software-simulation'));assert.equal(nvda.summary,'Platform');
  const layers=industryTree(graph.nodes.filter(n=>n.kind==='COMPANY'));assert.equal(industryRootLabel(layers,'en'),'Robotics industry');
  assert.equal(layers.filter(layer=>layer.companies.some(n=>n.id==='US:NVDA')).length,2);
  const open=new Set(['root',...layers.map(layer=>layer.id)]);
  for(const layout of [layoutIndustryTree,layoutVerticalTree]){
    const nodes=layout(layers,open,'en');
    assert.equal(nodes.filter(node=>node.kind==='branch'&&!node.decorative).length,0);
    assert.equal(nodes.filter(node=>node.kind==='company').length,3);
    assert(nodes.filter(node=>node.kind==='company').every(node=>nodes.some(parent=>parent.id===node.parent&&(parent.kind==='layer'||parent.decorative))));
    assert.equal(layout(layers,new Set(['root']),'en').filter(node=>node.kind==='company').length,0);
  }
  assert.equal(roboticsGraph([company,other],[{...relationship,themeIds:['robotics']}]).relationships.length,1);
  assert.deepEqual(company.themeMemberships.robotics,member);assert.equal(parseCompanyTheme('unknown'),'ai');
});


test('sparse sector themes retain full decorative canopies without inventing companies',async()=>{
  const {layoutVerticalTree}=await import('../src/lib/ui/knowledge-graph/vertical-tree');
  const {verticalTreeStrands,verticalTreeStrandGeometries,createStrandWriter}=await import('../src/lib/ui/knowledge-graph/vertical-tree-geometry');
  for(const theme of ['robotics','space']){
    const layers=[0,1,2].map(i=>({id:`${theme}:sector-${i}`,en:`Sector ${i}`,zh:`Sector ${i}`,color:'#67e6bc',stages:[],branches:[],directCompanies:true,
      companies:[{id:`US:COMPANY-${i}`,name:`Company ${i}`,kind:'COMPANY' as const,order:i}]}));
    const nodes=layoutVerticalTree(layers,new Set(['root',...layers.map(l=>l.id)]),'en');
    const leaves=nodes.filter(n=>n.kind==='company');
    assert.equal(leaves.length,3);
    assert.equal(nodes.filter(n=>n.kind==='branch'&&!n.decorative).length,0);
    const canopySlots=(6+4+4)*6;
    assert.deepEqual(layers.map(layer=>nodes.filter(n=>n.kind==='branch'&&n.layer===layer.id).length),[6,4,4],'the lower canopy has additional boughs');
    assert.equal(nodes.filter(n=>n.kind==='foliage').length,canopySlots-leaves.length);
    assert(nodes.filter(n=>n.decorative).every(n=>!n.company&&!n.label));
    assert.deepEqual(nodes.filter(n=>n.kind==='layer').map(n=>n.count),[1,1,1]);
    const more=layers.map(layer=>({...layer,companies:[...layer.companies,{...layer.companies[0],id:layer.companies[0].id+'-NEW'}]}));
    const fuller=layoutVerticalTree(more,new Set(['root',...more.map(l=>l.id)]),'en');
    assert.equal(fuller.filter(n=>n.kind==='company'||n.kind==='foliage').length,canopySlots,'company additions replace decorative leaves rather than changing canopy density');
    assert.deepEqual(fuller.filter(n=>n.kind==='branch').map(n=>n.position),nodes.filter(n=>n.kind==='branch').map(n=>n.position),'wood silhouette stays independent of company coverage');
    const strands=verticalTreeStrands(nodes);
    for(const leaf of leaves){
      const limb=strands.find(s=>s.to===leaf.id);
      assert.equal(limb?.kind,'twig');
      const parent=nodes.find(n=>n.id===leaf.parent)!;
      assert(parent.decorative&&parent.kind==='branch');
      assert(strands.some(s=>s.to===parent.id&&s.kind==='branch'));
    }
    const geometry=verticalTreeStrandGeometries(strands,'');
    createStrandWriter()(strands,geometry,id=>{const p=nodes.find(n=>n.id===id)?.position;return p?{x:p[0],y:p[1],z:p[2]}:undefined;},nodes.filter(n=>n.kind==='layer').map(n=>n.position[1]));
    assert(Array.from(geometry[0].getAttribute('position').array).every(Number.isFinite));
    geometry.forEach(g=>g.dispose());
  }
});

test('enrollment uses local push updates including an empty result',async()=>{
 let calls=0;let push:(value:unknown)=>void=()=>{};
 const query={where:()=>query,onSnapshot:(next:(value:unknown)=>void)=>{calls++;push=next;next({docs:[]});return ()=>{};}};
 const db={collection:()=>query} as unknown as Firestore;
 assert.deepEqual(await loadCollectionCompanies(db,'US'),[]);
 push({docs:[{id:'US:A',get:(field:string)=>field==='exchange_region'?'US':undefined,data:()=>({name:'A',status:'DIRECTORY',symbol:'A',themeIds:['ai'],themeMemberships:{ai:{status:'PUBLISHED'}},kind:'COMPANY'})}]});
 assert.equal((await loadCollectionCompanies(db,'US')).length,1);
 assert.deepEqual(await loadCollectionCompanies(db,'CN'),[]);assert.equal(calls,1);
});
