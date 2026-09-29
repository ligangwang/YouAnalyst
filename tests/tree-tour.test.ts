import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeTour, treeTourStops, treeTourPlan, treeTourFromView, type TreeTourStop } from '../src/lib/knowledge-graph/tree-tour';
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
  assert.equal(stops.length,layers.reduce((sum,l)=>sum+l.branches.reduce((s,b)=>s+(l.id==='energy'?b.companies.length:Math.ceil(b.companies.length/4)),0),0));
  assert.deepEqual(treeTourStops([...nodes].reverse()),stops);
  const plan=treeTourPlan(nodes,1);
  assert.deepEqual(treeTourPlan([...nodes].reverse(),1),plan);
  assert.deepEqual([...new Set(plan.filter(s=>s.kind==='company').map(s=>s.layer))],layers.map(l=>l.id));
  assert.equal(plan.filter(s=>s.kind==='company').length,stops.length,'all company groups remain in the tour');
  const strands=verticalTreeStrands(nodes),geometries=verticalTreeStrandGeometries(strands,'');
  const energyCompanies=companies.filter(n=>n.layer==='energy');
  assert.equal(energyCompanies.length,3);
  const companyRoots=strands.filter(s=>s.attach==='node'&&energyCompanies.some(n=>n.id===s.to));
  assert.equal(companyRoots.length,energyCompanies.length,'every energy company has its own root');
  assert.equal(plan.filter(s=>s.kind==='company'&&s.layer==='energy').length,energyCompanies.length,'the tour visits each separate root');
  assert(companyRoots.every(s=>s.from==='energy/energy'),'Energy supply is the visible parent of all three company roots');
  assert(energyCompanies.every(n=>n.parent==='energy/energy'));
  assert.equal(nodes.find(n=>n.id==='energy/energy')?.parent,'energy');
  for(const branch of branches.filter(n=>n.layer==='energy'))assert(strands.some(s=>s.from==='energy'&&s.to===branch.id),'expanded Energy categories retain their connector');
  for(let i=0;i<energyCompanies.length;i++)for(let j=i+1;j<energyCompanies.length;j++){
    assert(Math.hypot(...energyCompanies[i].position.map((v,axis)=>v-energyCompanies[j].position[axis]))>700,'energy companies spread around the trunk');
  }
  createStrandWriter()(strands,geometries,id=>{const p=nodes.find(n=>n.id===id)?.position;return p?{x:p[0],y:p[1],z:p[2]}:undefined;},nodes.filter(n=>n.kind==='layer').map(n=>n.position[1]));
  const positions=geometries[0].getAttribute('position');
  assert(Array.from(positions.array).every(Number.isFinite));
  assert(Array.from({length:positions.count},(_,i)=>positions.getZ(i)).some(z=>z>100));
  // Check rendered endpoints too: the writer must not replace the semantic
  // parent with the decorative trunk base when drawing root connections.
  const verticesPerStrand=positions.count/strands.length;
  for(const strand of strands.filter(s=>s.attach==='node')){
    const index=strands.indexOf(strand);
    for(const [id,offset] of [[strand.from,0],[strand.to,verticesPerStrand-36+2]] as const){
      const ring=Array.from({length:6},(_,face)=>index*verticesPerStrand+offset+face*6);
      const centre=[0,1,2].map(axis=>ring.reduce((sum,v)=>sum+positions.getComponent(v,axis),0)/6);
      const node=nodes.find(n=>n.id===id)!;
      assert(Math.hypot(...centre.map((v,axis)=>v-node.position[axis]))<4.01,`${strand.from} → ${strand.to} meets ${id}`);
    }
  }
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

test('a manual view selects nearby companies and skips closed layers without a camera jump',()=>{
  const node=(id:string,y:number):TreePoint=>({id,kind:'layer',label:id,color:'#fff',position:[0,y,0],span:[y-400,y+400]});
  const nodes=[node('energy',0),node('chips',1000),node('models',2000)];
  const stops:TreeTourStop[]=nodes.flatMap(n=>[-300,300].map(x=>({target:[x,n.position[1],0] as [number,number,number],distance:1050,duration:20,hold:5,kind:'company' as const,layer:n.id})));
  const manual={position:[-2400,2300,-1800] as [number,number,number],target:[280,2000,100] as [number,number,number]};
  const nearby=treeTourFromView(stops,manual,nodes);
  assert.equal(nearby[0].layer,'models','honor a pan to an upper layer');
  assert.equal(nearby[0].target[0],300,'choose the company near the panned target');
  const tour=createTreeTour(manual,nearby,()=>.5);
  const first=tour(0);
  assert(Math.hypot(...first.position.map((v,i)=>v-manual.position[i]))<1e-8);
  assert.deepEqual(first.target,manual.target);
  assert(Math.hypot(...tour(.05).position.map((v,i)=>v-manual.position[i]))<.01,'ease toward the new company without snapping');
  for(let i=0;i<52;i++)tour(.25);
  assert.deepEqual(tour(0).target,nearby[0].target);
  const onlyLower=stops.filter(s=>s.layer!=='models');
  assert.equal(treeTourFromView(onlyLower,manual,nodes,'models')[0].layer,'energy','wrap smoothly to the next open layer after the crown');
  const mid={...manual,target:[0,1000,0] as [number,number,number]};
  assert.equal(treeTourFromView(stops.filter(s=>s.layer!=='chips'),mid,nodes)[0].layer,'models','skip the closed layer at the current position');
  assert.deepEqual(treeTourFromView([],manual,nodes),[]);
});

test('collapsed layers leave the tour and preserve the positions of other layers',()=>{
  const layers=industryTree(graph.nodes.filter(n=>n.kind==='COMPANY') as GraphNode[]);
  const open=new Set(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]);
  const before=layoutVerticalTree(layers,open,'en');
  const closed=layers[1].id;open.delete(closed);
  const after=layoutVerticalTree(layers,open,'en');
  for(const n of after.filter(n=>n.layer!==closed))assert.deepEqual(n.position,before.find(p=>p.id===n.id)!.position);
  assert(!treeTourPlan(after,1,open).some(stop=>stop.layer===closed));
  assert.deepEqual(treeTourPlan(before,1,new Set(['root'])),[],'all layers closed stops navigation');
  open.add(closed);
  assert(treeTourPlan(before,1,open).some(stop=>stop.layer===closed),'reopening returns the layer to the itinerary');
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


import { hierarchyTourPlan, hierarchyTourIndex } from '../src/lib/knowledge-graph/hierarchy-tour';
import { createIntroOrbit } from '../src/lib/knowledge-graph/intro-orbit';
import { tourDelta } from '../src/lib/knowledge-graph/tour-motion';

test('hierarchy groups cover every company at desktop and phone sizes without individual stops',()=>{
  const layers=industryTree(graph.nodes.filter(n=>n.kind==='COMPANY') as GraphNode[]);
  for(const width of [390,1200]){
    const plan=hierarchyTourPlan(layers,width,600);
    for(const layer of layers)for(const branch of layer.branches){
      const groups=plan.filter(stop=>stop.focus===branch.id&&stop.members);
      assert.deepEqual(new Set(groups.flatMap(stop=>stop.members!)),new Set(branch.companies.map(c=>branch.id+'/'+c.id)));
      if(branch.companies.length>1)assert(groups.every(stop=>stop.members!.length>1));
      assert(groups.every(stop=>stop.members!.length<=6));
    }
  }
});

test('tour clock and speed multipliers are consistent at 5, 20 and 60 fps',()=>{
  const start={position:[0,0,2000] as [number,number,number],target:[0,0,0] as [number,number,number]};
  const stops:TreeTourStop[]=[{target:[400,200,0],distance:1000,duration:20,hold:5,kind:'company',layer:'energy'}];
  for(const speed of [.5,1,1.5,2]){
    const results=[5,20,60].map(fps=>{
      const tree=createTreeTour(start,stops,()=>.5),orbit=createIntroOrbit(()=>.5);
      let shot=start,azimuth=0,elapsed=0;
      for(let i=0;i<fps*4;i++){shot=tree(1/fps,speed);azimuth+=orbit(1/fps,Math.PI/2,speed).azimuth;elapsed+=tourDelta(1/fps,speed);}
      return {shot,azimuth,elapsed};
    });
    for(const result of results){
      assert(Math.abs(result.elapsed-4*speed)<1e-8);
      assert(Math.abs(result.azimuth-results[0].azimuth)<1e-8);
      result.shot.position.forEach((v,i)=>assert(Math.abs(v-results[0].shot.position[i])<1e-8));
    }
  }
});


test('hierarchy parent redirects visit children, skip every closed group and wrap safely',()=>{
 const layers=industryTree(graph.nodes.filter(n=>n.kind==='COMPANY') as GraphNode[]);
 const plan=hierarchyTourPlan(layers,1000,400);
 for(const layer of layers){
  const start=hierarchyTourIndex(plan,layer.id,true);
  assert.equal(plan[start].focus,layer.id);
  const next=hierarchyTourIndex(plan,layer.id,false);
  assert(!plan[next].open.includes(layer.id));
  for(const branch of layer.branches){
   const child=hierarchyTourIndex(plan,branch.id,true);
   assert.equal(plan[child].focus,branch.id);
   assert(plan[child].members?.length);
   const after=hierarchyTourIndex(plan,branch.id,false);
   assert(!plan[after].open.includes(branch.id));
  }
 }
 assert.equal(hierarchyTourIndex(plan,layers.at(-1)!.id,false),0);
 assert.equal(hierarchyTourIndex(plan,'root',true),0);
});
