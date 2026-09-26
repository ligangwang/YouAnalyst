import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeTour, treeTourStops, treeTourPlan, type TreeTourStop } from '../src/lib/knowledge-graph/tree-tour';
import type { TreePoint } from '../src/lib/knowledge-graph/industry-tree';
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
  const plan=treeTourPlan(nodes,1);
  assert.deepEqual(treeTourPlan([...nodes].reverse(),1),plan);
  assert.deepEqual([...new Set(plan.filter(s=>s.kind==='company').map(s=>s.layer))],layers.map(l=>l.id));
  assert.equal(plan.filter(s=>s.kind==='company').length,stops.length,'all company groups remain in the tour');
  const strands=verticalTreeStrands(nodes),geometries=verticalTreeStrandGeometries(strands,'');
  createStrandWriter()(strands,geometries,id=>{const p=nodes.find(n=>n.id===id)?.position;return p?{x:p[0],y:p[1],z:p[2]}:undefined;},nodes.filter(n=>n.kind==='layer').map(n=>n.position[1]));
  const positions=geometries[0].getAttribute('position');
  assert(Array.from(positions.array).every(Number.isFinite));
  assert(Array.from({length:positions.count},(_,i)=>positions.getZ(i)).some(z=>z>100));
  geometries.forEach(g=>g.dispose());
});

test('tour eases from the overview, holds readable closeups and clamps delayed frames',()=>{
  const start={position:[0,1000,6000] as [number,number,number],target:[0,1000,0] as [number,number,number]};
  const stops:TreeTourStop[]=[[200,500,100],[-300,1200,-200]].map(target=>({target:target as [number,number,number],distance:1050,duration:20,hold:5,kind:'company',layer:'energy'}));
  const tour=createTreeTour(start,stops,()=>.5);
  assert.deepEqual(tour(0),start);
  const first=tour(.05);
  assert(Math.abs(first.position[2]-6000)<.01,'no initial lurch');
  for(let i=0;i<260;i++)tour(.05);
  const hold=tour(.05);
  assert.deepEqual(hold.target,stops[0].target);
  assert(Math.hypot(...hold.position.map((v,i)=>v-hold.target[i]))<1400);
  assert.deepEqual(tour(.05),hold);
  for(let i=0;i<520;i++)tour(.05);
  assert.deepEqual(tour(.05).target,stops[1].target);
  const a=createTreeTour(start,stops,()=>.5),b=createTreeTour(start,stops,()=>.5);
  assert.deepEqual(a(100),b(.25));
  const slow=createTreeTour(start,stops,()=>.5);
  for(let i=0;i<65;i++)slow(.2);
  assert.deepEqual(slow(0).target,stops[0].target,'a 5fps renderer reaches the close-up in the same twelve seconds');
});

test('layer tour pulls back, travels along the trunk, approaches the next layer and loops',()=>{
  const node=(id:string,kind:TreePoint['kind'],y:number,layer=id):TreePoint=>({id,kind,layer,label:id,color:'#fff',position:[kind==='company'?300:0,y,0]});
  // Company heights overlap: ownership, rather than height, must determine order.
  const nodes=[node('energy','layer',0),node('chips','layer',1200),node('ceg','company',1300,'energy'),node('nvda','company',1100,'chips')];
  for(const aspect of [1.6,.45]){
    const plan=treeTourPlan(nodes,aspect);
    assert.deepEqual(plan.map(s=>[s.kind,s.layer]),[['company','energy'],['overview','energy'],['transfer','chips'],['company','chips'],['overview','chips'],['transfer','energy']]);
    assert(plan[1].distance>plan[0].distance*2);
    assert.equal(plan[1].distance,plan[2].distance,'remain wide while moving between layers');
    const start={target:[0,600,0] as [number,number,number],position:[0,600,6000] as [number,number,number]};
    const tour=createTreeTour(start,plan,()=>.5);
    for(let index=0;index<=plan.length;index++){
      const stop=plan[index%plan.length],duration=index===0?12:stop.duration;
      for(let tick=0;tick<duration*4;tick++)tour(.25);
      const shot=tour(0);
      assert.deepEqual(shot.target,stop.target);
      assert(Math.abs(Math.hypot(shot.position[0]-shot.target[0],shot.position[2]-shot.target[2])-stop.distance)<1e-8);
      for(let tick=0;tick<stop.hold*4;tick++)tour(.25);
    }
  }
  assert.equal(treeTourPlan([],1).length,0);
  const start={target:[0,0,0] as [number,number,number],position:[0,0,6000] as [number,number,number]};
  assert.deepEqual(createTreeTour(start,[])(.25),start);
  assert.equal(treeTourPlan([nodes[0]],1)[0].layer,'energy','collapsed layers still receive a stop');
});
