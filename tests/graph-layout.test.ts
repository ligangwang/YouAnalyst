import { Vector3 } from 'three';
import { galaxyTour, galaxyTourFocus } from '../src/lib/ui/knowledge-graph/galaxy-tour';
import { galaxyToWorld, layoutGalaxy } from '../src/lib/ui/knowledge-graph/layout-galaxy';
import test from 'node:test';
import assert from 'node:assert/strict';
import us from '../data/ai-supply-chain/ai-us.json';
import cn from '../data/ai-supply-chain/ai-cn-a.json';
import { combineGraphs, filterGraph, layoutGraph, type KnowledgeGraph } from '../src/lib/knowledge-graph/model';
import { layoutCompanies } from '../src/lib/knowledge-graph/constellation';
import { layout3D } from '../src/lib/knowledge-graph/layout-3d';
import { marketCapScale, marketCapLabel } from '../src/lib/knowledge-graph/market-cap';
import { densitySelection } from '../src/lib/knowledge-graph/density';
const graph=combineGraphs([us,cn] as unknown as (KnowledgeGraph & {id:string;language:string})[]);

test('market cap areas scale proportionally within limits and unknown retains default', () => {
 const cap=(value:number)=>({value,currency:'USD' as const,priceDate:'2026-09-21'});
 assert.equal(marketCapScale(cap(400e9))/marketCapScale(cap(100e9)),2);
 assert.equal(marketCapScale(),1);
 assert.equal(marketCapScale(cap(NaN)),1);
 assert.equal(marketCapScale(cap(0)),1);
 assert.equal(marketCapScale(cap(1e6)),.65);
 assert.equal(marketCapScale(cap(10e12)),2.5);
 assert.equal(marketCapLabel(cap(1e12)),'$1T');
 assert.equal(marketCapLabel(),'');
});

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

test('large company universes retain deterministic unique finite positions', () => {
 const templates=graph.nodes.filter(n=>n.kind==='COMPANY');
 const nodes=Array.from({length:2000},(_,i)=>({...templates[i%templates.length],id:`US:SYNTH${String(i).padStart(5,'0')}`}));
 const input={...graph,nodes,relationships:[]};
 const first=layout3D(input), second=layout3D(input);
 assert.equal(first.nodes.length,2000);
 assert.deepEqual(first.nodes.map(n=>[n.id,n.x,n.y,n.z]),second.nodes.map(n=>[n.id,n.x,n.y,n.z]));
 assert.equal(new Set(first.nodes.map(n=>`${n.x},${n.y},${n.z}`)).size,2000);
 assert(first.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&Number.isFinite(n.z)));
});

test('density selection bounds crowded points and preserves focused company',()=>{
 const points=Array.from({length:1000},(_,i)=>({id:`company-${i}`,x:(i%20)*5,y:Math.floor(i/20)*5,depth:i/1000,priority:i===999?3:1}));
 const selected=densitySelection(points,200,300,36,50);
 assert(selected.includes('company-999'));
 assert(selected.length<=51);
 assert.deepEqual(selected,densitySelection([...points].reverse(),200,300,36,50));
});

const galaxy = layoutGalaxy(us as unknown as KnowledgeGraph);
const normal = galaxyToWorld(0, 1, 0), up = new Vector3(normal.x, normal.y, normal.z);
const flat = (v: Vector3) => v.clone().addScaledVector(up, -v.dot(up)).normalize();

function sample(steps: number, layout = galaxy) {
  const tour = galaxyTour(layout.nodes, layout.arms, layout.galaxyRadius)!;
  return Array.from({ length: steps + 1 }, (_, i) => { const eye = new Vector3(), target = new Vector3(); tour.at(i / steps, eye, target); return { eye, target }; });
}

test('galaxy tour focus only ever turns one way around the core', () => {
  const focus = galaxyTourFocus(galaxy.nodes, galaxy.arms, galaxy.galaxyRadius);
  assert.ok(focus.length > galaxy.arms.length);
  for (let i = 1; i < focus.length; i++) assert.ok(focus[i].angle > focus[i - 1].angle, `focus turned back at point ${i}`);
});

function turnsOf(layout: typeof galaxy) {
  const seconds = galaxyTour(layout.nodes, layout.arms, layout.galaxyRadius)!.loopSeconds(12), steps = Math.round(seconds * 10), frames = sample(steps, layout);
  const turns = frames.slice(1).map((frame, i) => {
    const before = flat(frames[i].target.clone().sub(frames[i].eye)), after = flat(frame.target.clone().sub(frame.eye));
    return Math.atan2(before.clone().cross(after).dot(up), before.dot(after));
  });
  // Whichever way the galaxy's spiral turns, every moment of the loop turns that same way.
  const direction = Math.sign(turns.reduce((sum, turn) => sum + turn, 0));
  turns.forEach((turn, i) => assert.ok(turn * direction > -1e-6, `view turned back by ${(Math.abs(turn) * 180 / Math.PI).toFixed(4)}° at ${(i / 10).toFixed(1)}s`));
  const turned = Math.abs(turns.reduce((sum, turn) => sum + turn, 0)), fastest = Math.max(...turns.map(turn => Math.abs(turn) * 180 / Math.PI * 10));
  return { seconds, turned, fastest };
}

test('galaxy tour camera never reverses its turn and keeps a slow, steady pace', () => {
  const { seconds, turned, fastest } = turnsOf(galaxy);
  console.log(`loop ${seconds}s, ${(turned / Math.PI / 2).toFixed(2)} turns, fastest ${fastest.toFixed(2)}°/s, mean ${(turned * 180 / Math.PI / seconds).toFixed(2)}°/s`);
  // The loop closes after whole turns around the galaxy, and no bend is rushed.
  assert.ok(Math.abs(turned / (Math.PI * 2) - Math.round(turned / (Math.PI * 2))) < .01);
  assert.ok(fastest < 3.5 && fastest < turned * 180 / Math.PI / seconds * 1.3, `fastest turn ${fastest.toFixed(2)}°/s`);
});

test('galaxy tour passes close by every company', () => {
  const frames = sample(8000), R = galaxy.galaxyRadius;
  for (const node of galaxy.nodes) {
    const at = new Vector3(node.x, node.y, node.z);
    const nearest = Math.min(...frames.map(frame => frame.target.distanceTo(at)));
    assert.ok(nearest < R * .2, `${node.id} is ${(nearest / R).toFixed(2)}R from the tour`);
  }
});

test('galaxy tour presents every company once per loop', () => {
  const tour = galaxyTour(galaxy.nodes, galaxy.arms, galaxy.galaxyRadius)!, steps = 12 * galaxy.nodes.length * 10;
  const visits = new Map<string, number>(), eye = new Vector3(), target = new Vector3();
  let held = '';
  for (let i = 0; i < steps; i++) {
    tour.at(i / steps, eye, target);
    const next = tour.company(i / steps, target, held);
    if (next && next !== held) visits.set(next, (visits.get(next) ?? 0) + 1);
    held = next;
  }
  const missed = galaxy.nodes.filter(n => !visits.has(n.id)).map(n => n.id), repeated = [...visits].filter(([, count]) => count > 1);
  console.log(`presented ${visits.size}/${galaxy.nodes.length}, repeated ${repeated.length}: ${repeated.map(([id, n]) => `${id}x${n}`).join(' ')}; missed: ${missed.join(' ')}`);
  assert.ok(visits.size >= galaxy.nodes.length * .9, `only ${visits.size} of ${galaxy.nodes.length} companies were presented`);
  assert.ok(repeated.length <= galaxy.nodes.length * .05, `${repeated.length} companies were presented more than once`);
});

test('galaxy tour stays slow when a search leaves only a few companies', () => {
  const companies = (us as unknown as KnowledgeGraph).nodes.filter(n => n.kind === 'COMPANY');
  for (const count of [1, 2, 5]) {
    const small = layoutGalaxy({ ...(us as unknown as KnowledgeGraph), nodes: companies.slice(0, count) });
    const { seconds, turned, fastest } = turnsOf(small);
    const mean = turned * 180 / Math.PI / seconds;
    assert.ok(mean <= 2.6 && fastest < 3.5, `${count} companies: mean ${mean.toFixed(2)}°/s, fastest ${fastest.toFixed(2)}°/s over ${seconds.toFixed(0)}s`);
  }
});
