import assert from 'node:assert/strict';
import test from 'node:test';
import {stockSectors,stockSectorPeers} from '../../src/lib/knowledge-graph/stock-sectors';
import type {GraphNode,KnowledgeGraph} from '../../src/lib/knowledge-graph/model';

const company=(id:string,stageIds=['memory'],market:GraphNode['market']='US'):GraphNode=>({id,kind:'COMPANY',order:0,name:id,stageIds,market});
const micron=company('US:MU'),hynix=company('US:SKHY'),sandisk=company('US:SNDK'),unknown=company('US:UNKNOWN');
const graph:KnowledgeGraph={asOf:'2026-10-16',relationships:[],sources:[],nodes:[
 {id:'stage:memory',kind:'STAGE',order:0,label:'Memory & storage',labels:{en:'Memory & storage','zh-CN':'内存与存储'}},micron,hynix,sandisk,unknown,
]};

test('Micron exposes independently sourced products and end markets without duplicate industry labels',()=>{
 const sectors=stockSectors(micron,graph);
 assert.equal(sectors.filter(item=>item.group==='business').length,9);
 assert.equal(sectors.filter(item=>item.zh==='内存与存储').length,1);
 assert.ok(sectors.some(item=>item.group==='industry'));
 assert.ok(sectors.some(item=>item.id==='market:US'));
 for(const item of sectors.filter(item=>item.group==='business')){
  assert.ok(item.sources.length>0);
  assert.ok(item.sources.every(source=>new URL(source.url).hostname==='www.micron.com'));
 }
 assert.equal(new Set(sectors.map(item=>item.id)).size,sectors.length);
});

test('HBM peers require explicit product coverage, not memory stages or mentions',()=>{
 const hbm=stockSectors(micron,graph).find(item=>item.id==='business:hbm')!;
 const mentioning={...unknown,summary:'HBM customer; product qualification not established.'};
 assert.deepEqual(stockSectorPeers(hbm,micron.id,{...graph,nodes:[...graph.nodes,mentioning,hynix]}).map(item=>item.id),['US:SKHY']);
 assert.ok(stockSectors(sandisk,graph).some(item=>item.id==='business:nand'));
 assert.ok(!stockSectors(sandisk,graph).some(item=>item.id==='business:dram'));
 assert.ok(!stockSectors(mentioning,graph).some(item=>item.group==='business'));
});

test('watchlist and listing markets are separate from industry and business classifications',()=>{
 const saved=[micron.id,sandisk.id,'US:OUTSIDE-GRAPH'];
 const watchlist=stockSectors(micron,graph,saved).find(item=>item.id==='watchlist:saved')!;
 assert.deepEqual(stockSectorPeers(watchlist,micron.id,graph,saved).map(item=>item.id),[sandisk.id]);
 assert.ok(!stockSectors(unknown,graph,saved).some(item=>item.group==='watchlist'));
 assert.ok(!stockSectors(company('ORG:PRIVATE',[],'GLOBAL'),graph).some(item=>item.group==='market'));
 assert.equal(stockSectors(company('XSHG:688008',[],'CN_A'),graph).find(item=>item.group==='market')?.zh,'中国 A 股');
});

test('same named AI and Space sectors retain distinct memberships and unknown roles are omitted',()=>{
 const ai=company('US:AI',['applications']),space=company('US:SPACE',['space:applications']);
 const aiSector=stockSectors(ai,graph).find(item=>item.group==='industry')!;
 const spaceSector=stockSectors(space,graph).find(item=>item.group==='industry')!;
 assert.notEqual(aiSector.id,spaceSector.id);
 assert.deepEqual(stockSectorPeers(aiSector,ai.id,{...graph,nodes:[ai,space]}),[]);
 assert.deepEqual(stockSectors(company('ORG:UNKNOWN',['unknown'],'GLOBAL'),graph),[]);
});

test('distinct recorded supply-chain roles retain their localized labels',()=>{
 const chip=company('US:CHIP',['equipment']);
 const roles=stockSectors(chip,{...graph,nodes:[...graph.nodes,{id:'stage:equipment',kind:'STAGE',order:1,labels:{en:'Manufacturing equipment','zh-CN':'制造设备'}}]});
 assert.ok(roles.some(item=>item.group==='industry'&&item.en==='Semiconductors'));
 assert.ok(roles.some(item=>item.id==='stage:equipment'&&item.zh==='制造设备'));
});

test('explicit private status excludes both US and China listing-market groups and peers',()=>{
 const privateNodes=(['US','CN_A'] as const).map(market=>({...company('ORG:PRIVATE-'+market,[],market),listingStatus:'PRIVATE' as const}));
 for(const node of privateNodes)assert.ok(!stockSectors(node,graph).some(item=>item.group==='market'));
 const market=stockSectors(micron,graph).find(item=>item.id==='market:US')!;
 assert.deepEqual(stockSectorPeers(market,micron.id,{...graph,nodes:[micron,hynix,...privateNodes]}).map(node=>node.id),[hynix.id]);
});
