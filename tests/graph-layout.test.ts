import test from 'node:test';
import assert from 'node:assert/strict';
import us from '../data/ai-supply-chain/ai-us.json';
import cn from '../data/ai-supply-chain/ai-cn-a.json';
import { combineGraphs, filterGraph, layoutGraph, type KnowledgeGraph } from '../src/lib/knowledge-graph/model';
import { layoutCompanies } from '../src/lib/knowledge-graph/constellation';
import { layout3D } from '../src/lib/knowledge-graph/layout-3d';
const graph=combineGraphs([us,cn] as unknown as (KnowledgeGraph & {id:string;language:string})[]);

test("combination retains every company and isolates evidence IDs", () => {
  assert.equal(graph.nodes.filter(n => n.kind === "COMPANY").length,129);
  assert.equal(new Set(graph.sources.map(s => s.id)).size,graph.sources.length);
  const sourceIds = new Set(graph.sources.map(s => s.id));
  assert(graph.relationships.every(e => e.sourceIds.every(id => sourceIds.has(id))));
  for (const markets of [["US"], ["CN_A"], ["US", "CN_A"]] as const) {
    const visible = filterGraph(graph, [...markets]);
    const positions = layoutGraph(visible.nodes).positions;
    assert(visible.nodes.every(n => positions.has(n.id)));
    assert(visible.relationships.every(e => positions.has(e.source) && positions.has(e.target)));
  }
});

test("star layout retains isolated companies and only draws recorded company edges", () => {
  const layout = layoutCompanies(graph);
  assert.equal(layout.nodes.length,129);
  assert.deepEqual(layout.edges,graph.relationships.filter(e => e.type !== "PARTICIPATES_IN"));
  assert(layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= 0 && n.x <= layout.width && n.y >= 0 && n.y <= layout.height));
  assert.deepEqual(layoutCompanies(graph),layout);
});

test("company layout retains real depth",()=>{
  const layout=layout3D(graph);
  assert.equal(layout.nodes.length,129);
  for(const axis of ["x","y","z"] as const){
    const positions=layout.nodes.map(n=>n[axis]);
    assert(Math.max(...positions)-Math.min(...positions)>150);
  }
});

test("unclassified companies have their own spatial anchor",()=>{
 const layout=layout3D({...graph,nodes:[...graph.nodes,{id:"ORG:RELATED",kind:"COMPANY",name:"Related company",stageIds:["related"],market:"GLOBAL",order:999}]});
 const related=layout.nodes.find(n=>n.id==="ORG:RELATED")!;
 const semiconductor=layout.nodes.find(n=>n.stageIds?.[0]==="materials")!;
 assert.notDeepEqual([related.ax,related.ay,related.az],[semiconductor.ax,semiconductor.ay,semiconductor.az]);
});
