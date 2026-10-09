import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeGraph } from '../src/lib/knowledge-graph/model';
import { activeThemeIds, collectionUniverse, isCollectionCompany, type ThemedCompany } from '../src/lib/company-themes/model';
import { planCompanyThemeMigration, validateRoboticsBatch } from '../src/lib/company-themes/migration';
import batch from '../data/robotics/company-memberships.json';
import { NEWS_SOURCES } from '../scripts/seed-news-sources';
import { usMapTickers } from '../src/lib/knowledge-graph/us-companies';
import { cnMapCompanies } from '../src/lib/knowledge-graph/cn-companies';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCollectionCompanies, loadCollectionUniverse, loadThemeCompanies } from '../src/lib/company-themes/service';
import spaceBatch from '../data/space/company-memberships.json';
import {planThemeEnrollment,validateThemeBatch} from '../src/lib/company-themes/migration';
import {themedGraph} from '../src/lib/company-themes/presentation';
import {themeMetadata} from '../src/lib/company-themes/metadata';

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
  for (const theme of ['ai','robotics','space']) assert.equal(themeMetadata(theme).title,'AI, Robotics & Space Stocks and Companies | YouAnalyst');
  assert.match(themeMetadata('robotics').description,/robotics companies/);
  assert.equal(themeMetadata(undefined).canonical,'/');
  assert.deepEqual(themeMetadata('invalid'),themeMetadata('ai'));
});

const ai: KnowledgeGraph = { nodes: Array.from({ length: 134 }, (_, i) => ({ id: i === 0 ? 'US:NVDA' : `US:AI${i}`, kind: 'COMPANY' as const, name: i === 0 ? batch.companies[0].expectedName : `Company ${i}`, order: i, stageIds: ['compute'] })),
  relationships: [{ id: 'published-contract', source: 'US:NVDA', target: 'US:AI1', type: 'SUPPLIER', summary: 'Reviewed relationship', sourceIds: ['original-source'], commercialStatus: 'SHIPPED' }],
  sources: [{ id: 'original-source', title: 'Original source', url: 'https://example.com/original', sourceDate: '2026-01-01' }], asOf: '2026-10-04' };
function records(): ThemedCompany[] {
  const rows = new Map(ai.nodes.map(node => [node.id, { id: node.id, name: node.name, status: 'DIRECTORY', aiGraph: { status: 'PUBLISHED', stageIds: ['compute'], sources: ['original-source'] } } as ThemedCompany]));
  for (const proposal of batch.companies) if (!rows.has(proposal.id)) rows.set(proposal.id, { id: proposal.id, name: proposal.expectedName, status: 'DIRECTORY' });
  return [...rows.values()];
}

test('membership migration preserves all 134 AI companies, graph data and overlapping identities; reruns are idempotent', () => {
  const before = records(); const untouched = structuredClone(before); const originalGraph = structuredClone(ai);
  const patches = planCompanyThemeMigration(before, ai, batch);
  const after = before.map(row => ({ ...row, ...patches.find(patch => patch.id === row.id) }));
  assert.deepEqual(before, untouched); assert.deepEqual(ai, originalGraph);
  assert.equal(after.filter(row => row.themeIds?.includes('ai')).length, 134);
  assert.equal(after.filter(row => row.themeIds?.includes('robotics')).length, 16);
  assert.deepEqual(after.find(row => row.id === 'US:NVDA')!.themeIds, ['ai', 'robotics']);
  for (const patch of patches) assert.deepEqual(Object.keys(patch).sort(), ['expectedName', 'id', 'themeIds', 'themeMemberships']);
  const union = collectionUniverse(ai, after);
  assert.equal(new Set(union.nodes.map(node => node.id)).size, union.nodes.length);
  assert.deepEqual(union.relationships, originalGraph.relationships); assert.deepEqual(union.sources, originalGraph.sources);
  for (const node of ai.nodes) assert.deepEqual(union.nodes.find(row => row.id === node.id), node);
  assert.equal(planCompanyThemeMigration(after, ai, batch).length, 0);
  assert(usMapTickers(union).includes('CGNX')); assert(cnMapCompanies(union).includes('XSHE:300124'));
  for (const proposal of batch.companies.filter(row => row.id.startsWith('US:'))) assert(NEWS_SOURCES.some(source => source.companyId === proposal.id), `${proposal.id}: missing IR adapter`);
});

test('relationship-only AI neighbors and unrelated theme memberships survive additive migration', () => {
  const rows = records(); delete rows[1].aiGraph;
  rows[1].themeMemberships = { future: { status: 'PUBLISHED', primarySector: 'other', reviewedAt: '2026-01-01' } };
  const patches = planCompanyThemeMigration(rows, ai, batch);
  assert.deepEqual(patches.find(row => row.id === rows[1].id)!.themeIds, ['ai', 'future']);
  assert.deepEqual(patches.find(row => row.id === rows[1].id)!.themeMemberships.future, rows[1].themeMemberships.future);
});

test('invalid identities, sectors, dates and conflicting editorial decisions stop migration', () => {
  for (const patch of [{ reviewedAt: '2026-02-30' }, { companies: [...batch.companies, batch.companies[0]] }, { companies: [{ ...batch.companies[0], primarySector: 'unreviewed' }] }]) assert.throws(() => validateRoboticsBatch({ ...batch, ...patch }));
  const changed = records(); changed.find(row => row.id === batch.companies[0].id)!.name = 'Different company';
  assert.throws(() => planCompanyThemeMigration(changed, ai, batch), /identity changed/);
  const withdrawn = records(); withdrawn[0].themeMemberships = { ai: { status: 'WITHDRAWN', primarySector: 'compute', reviewedAt: '2026-01-01' } };
  assert.throws(() => planCompanyThemeMigration(withdrawn, ai, batch), /editorial status conflicts/);
});

test('authoritative membership status controls job eligibility and future enrollment needs no ticker list', () => {
  const row: ThemedCompany = { id: 'US:NEW', name: 'New company', status: 'DIRECTORY', themeIds: ['robotics'], themeMemberships: { robotics: { status: 'PUBLISHED', primarySector: 'sensors-vision', reviewedAt: '2026-10-04' } } };
  assert(isCollectionCompany(row)); assert(usMapTickers(collectionUniverse(ai, [row])).includes('NEW'));
  row.themeMemberships!.robotics.status = 'WITHDRAWN'; assert(!isCollectionCompany(row)); assert.deepEqual(activeThemeIds(row), []);
  row.aiGraph = { status: 'PUBLISHED' }; assert(isCollectionCompany(row));
  row.themeMemberships!.ai = { status: 'WITHDRAWN', primarySector: 'compute', reviewedAt: '2026-10-04' }; assert(!isCollectionCompany(row));
});

test('indexed theme reads reject stale array entries and combined enrollment deduplicates legacy records', async () => {
  const membership = { status: 'PUBLISHED', primarySector: 'compute-control', reviewedAt: '2026-10-04' };
  const rows = [
    { id: 'US:NVDA', name: 'NVIDIA', status: 'DIRECTORY', themeIds: ['ai', 'robotics'], themeMemberships: { ai: membership, robotics: membership }, aiGraph: { status: 'PUBLISHED' } },
    { id: 'US:OLD', name: 'Withdrawn company', status: 'DIRECTORY', themeIds: ['robotics'], themeMemberships: { robotics: { ...membership, status: 'WITHDRAWN' } } },
    { id: 'US:HIDDEN', name: 'Hidden company', status: 'DRAFT', themeIds: ['robotics'], themeMemberships: { robotics: membership } },
  ];
  const db = { collection: (name: string) => { assert.equal(name, 'companies'); return { where: (field: string, operator: string, value: string | string[]) => ({ get: async () => ({ docs: rows.filter(row => {
    if (field === 'themeIds') return operator === 'array-contains' ? row.themeIds.includes(String(value)) : row.themeIds.some(theme => value.includes(theme));
    return field === 'aiGraph.status' && row.aiGraph?.status === value;
  }).map(row => ({ id: row.id, data: () => row })) }) }) }; } } as unknown as Firestore;
  assert.deepEqual((await loadThemeCompanies('robotics', db)).map(row => row.id), ['US:NVDA']);
  assert.deepEqual((await loadCollectionCompanies(db)).map(row => row.id), ['US:NVDA']);
});

test('withdrawn AI enrollment overrides legacy graph flags while neighbors and another published theme remain eligible', async () => {
  const record: ThemedCompany = { id: 'US:NVDA', name: 'NVIDIA', status: 'DIRECTORY', themeIds: [], aiGraph: { status: 'PUBLISHED' }, themeMemberships: { ai: { status: 'WITHDRAWN', primarySector: 'compute', reviewedAt: '2026-10-04' } } };
  const db = { collection: () => ({ where: (field: string) => ({ get: async () => ({ docs: field === 'aiGraph.status' ? [{ id: record.id, data: () => record }] : [] }) }) }) } as unknown as Firestore;
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
  const {industryTree,industryRootLabel,layoutIndustryTree}=await import('../src/lib/knowledge-graph/industry-tree');
  const {layoutVerticalTree}=await import('../src/lib/knowledge-graph/vertical-tree');
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
  const {layoutVerticalTree}=await import('../src/lib/knowledge-graph/vertical-tree');
  const {verticalTreeStrands,verticalTreeStrandGeometries,createStrandWriter}=await import('../src/lib/knowledge-graph/vertical-tree-geometry');
  for(const theme of ['robotics','space']){
    const layers=[0,1,2].map(i=>({id:`${theme}:sector-${i}`,en:`Sector ${i}`,zh:`Sector ${i}`,color:'#67e6bc',stages:[],branches:[],directCompanies:true,
      companies:[{id:`US:COMPANY-${i}`,name:`Company ${i}`,kind:'COMPANY' as const,order:i}]}));
    const nodes=layoutVerticalTree(layers,new Set(['root',...layers.map(l=>l.id)]),'en');
    const leaves=nodes.filter(n=>n.kind==='company');
    assert.equal(leaves.length,3);
    assert.equal(nodes.filter(n=>n.kind==='branch'&&!n.decorative).length,0);
    assert.equal(nodes.filter(n=>n.kind==='foliage').length,69);
    assert(nodes.filter(n=>n.decorative).every(n=>!n.company&&!n.label));
    assert.deepEqual(nodes.filter(n=>n.kind==='layer').map(n=>n.count),[1,1,1]);
    const more=layers.map(layer=>({...layer,companies:[...layer.companies,{...layer.companies[0],id:layer.companies[0].id+'-NEW'}]}));
    const fuller=layoutVerticalTree(more,new Set(['root',...more.map(l=>l.id)]),'en');
    assert.equal(fuller.filter(n=>n.kind==='company'||n.kind==='foliage').length,72,'company additions replace decorative leaves rather than changing canopy density');
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
