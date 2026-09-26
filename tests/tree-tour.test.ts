import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeTour, treeTourStops } from '../src/lib/knowledge-graph/tree-tour';
import { industryTree } from '../src/lib/knowledge-graph/industry-tree';
import { layoutVerticalTree } from '../src/lib/knowledge-graph/vertical-tree';
import { createStrandWriter, verticalTreeStrands, verticalTreeStrandGeometries } from '../src/lib/knowledge-graph/vertical-tree-geometry';
import type { GraphNode } from '../src/lib/knowledge-graph/model';
import graph from '../data/ai-supply-chain/ai-us.json';

test('tree has depth, connected 3D wood and a complete deterministic company itinerary',()=>{
  const layers=industryTree(graph.nodes.filter(n=>n.kind==='COMPANY') as GraphNode[]);
  const nodes=layoutVerticalTree(layers,new Set(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]),'en');
  const companies=nodes.filter(n=>n.kind==='company');
  assert(Math.max(...companies.map(n=>n.position[2]))-Math.min(...companies.map(n=>n.position[2]))>300);
  const branches=nodes.filter(n=>n.kind==='branch');
  assert.equal(new Set(branches.map(n=>`${n.position[0]>=0},${n.position[2]>=0}`)).size,4,'branches surround all sides of the trunk');
  assert.equal(new Set(companies.map(n=>`${n.position[0]>=0},${n.position[2]>=0}`)).size,4,'leaves fill the canopy around the trunk');
  const stops=treeTourStops(nodes);
  assert.equal(stops.length,layers.reduce((sum,l)=>sum+l.branches.reduce((s,b)=>s+Math.ceil(b.companies.length/4),0),0));
  assert.deepEqual(treeTourStops([...nodes].reverse()),stops);
  const strands=verticalTreeStrands(nodes),geometries=verticalTreeStrandGeometries(strands,'');
  createStrandWriter()(strands,geometries,id=>{const p=nodes.find(n=>n.id===id)?.position;return p?{x:p[0],y:p[1],z:p[2]}:undefined;},nodes.filter(n=>n.kind==='layer').map(n=>n.position[1]));
  const positions=geometries[0].getAttribute('position');
  assert(Array.from(positions.array).every(Number.isFinite));
  assert(Array.from({length:positions.count},(_,i)=>positions.getZ(i)).some(z=>z>100));
  geometries.forEach(g=>g.dispose());
});

test('tour eases from the overview, holds readable closeups and clamps delayed frames',()=>{
  const start={position:[0,1000,6000] as [number,number,number],target:[0,1000,0] as [number,number,number]};
  const stops:[number,number,number][]=[[200,500,100],[-300,1200,-200]];
  const tour=createTreeTour(start,stops,1,()=>.5);
  assert.deepEqual(tour(0),start);
  const first=tour(.05);
  assert(Math.abs(first.position[2]-6000)<.01,'no initial lurch');
  for(let i=0;i<260;i++)tour(.05);
  const hold=tour(.05);
  assert.deepEqual(hold.target,stops[0]);
  assert(Math.hypot(...hold.position.map((v,i)=>v-hold.target[i]))<1400);
  assert.deepEqual(tour(.05),hold);
  for(let i=0;i<520;i++)tour(.05);
  assert.deepEqual(tour(.05).target,stops[1]);
  const a=createTreeTour(start,stops,1,()=>.5),b=createTreeTour(start,stops,1,()=>.5);
  assert.deepEqual(a(100),b(.05));
});
