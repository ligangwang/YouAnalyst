import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateGraph, type Graph } from "../src/lib/knowledge-graph/validate-seed";

import { graphFromMarket, type MarketCompany } from "../src/lib/knowledge-graph/market-store";
import { layoutVerticalTree, verticalBranchOrigin } from '../src/lib/knowledge-graph/vertical-tree';
import { industryTree, layoutIndustryTree, type TreePoint } from '../src/lib/knowledge-graph/industry-tree';
import type { GraphNode } from '../src/lib/knowledge-graph/model';
import { createIntroCamera, createIntroOrbit } from '../src/lib/knowledge-graph/intro-orbit';
import { layout3D } from '../src/lib/knowledge-graph/layout-3d';
import { combineGraphs } from '../src/lib/knowledge-graph/model';
import type { KnowledgeGraph } from '../src/lib/knowledge-graph/model';
import { graphNodeMarketCapLabel } from '../src/lib/knowledge-graph/market-cap';
import { fitSelectionCamera } from '../src/lib/knowledge-graph/selection-camera';
import { PerspectiveCamera, Vector3 } from 'three';

test('selection camera tightly frames the neighborhood in wide and narrow viewports outside the ball', () => {
  const points = [{x:-240,y:-160,z:80},{x:260,y:180,z:-100},{x:60,y:30,z:180}];
  for (const [width,height] of [[1200,700],[360,500]]) {
    for (const direction of [new Vector3(0,0,1),new Vector3(1,.4,1).normalize()]) {
      const {position,target}=fitSelectionCamera(points,direction,width,height,200);
      assert(position.length()>=230-1e-8);
      const camera=new PerspectiveCamera(45,width/height,.1,10000);
      camera.position.copy(position);camera.lookAt(target);camera.updateMatrixWorld();
      const projected=points.map(p=>new Vector3(p.x,p.y,p.z).project(camera));
      const usableX=1-2*Math.min(110,width*.15)/width;
      const usableY=1-2*Math.min(65,height*.15)/height;
      assert(projected.every(p=>Math.abs(p.x)<=usableX+1e-8&&Math.abs(p.y)<=usableY+1e-8&&p.z<1));
      assert(projected.some(p=>Math.abs(Math.abs(p.x)-usableX)<1e-8||Math.abs(Math.abs(p.y)-usableY)<1e-8), 'fit reaches a padded boundary rather than adding excess distance');
    }
  }
});

test('graph node values prefer recorded local currency and explicitly label USD fallback', () => {
  const cap = {value: 10e9, currency: 'USD' as const, priceDate: '2026-09-25'};
  const local = {...cap, local: {value: 70e9, currency: 'CNY' as const, rateDate: '2026-09-25'}};
  assert.equal(graphNodeMarketCapLabel(local, 'en'), '¥70B CNY');
  assert.equal(graphNodeMarketCapLabel(local, 'zh-CN'), '¥700亿 CNY');
  assert.equal(graphNodeMarketCapLabel(cap, 'en'), '$10B USD');
  assert.equal(graphNodeMarketCapLabel({...local, local: {...local.local, value: NaN}}, 'en'), '$10B USD');
  assert.equal(graphNodeMarketCapLabel(undefined, 'en'), '');
});

test('3D companies fill a stable ball with interior nodes and real connections', () => {
  const graph = combineGraphs(graphs as unknown as (KnowledgeGraph & {id:string;language:string})[]);
  const before = structuredClone(graph);
  const layout = layout3D(graph);
  assert.deepEqual(graph, before);
  assert.equal(layout.nodes.length, 129);
  const radii = layout.nodes.map(n => Math.hypot(n.x,n.y,n.z) / layout.radius);
  assert(radii.filter(r => r < .65).length > 25, 'interior companies, not just a shell');
  assert(radii.filter(r => r > .85).length > 35, 'outer nodes define the ball');
  const spans = (['x','y','z'] as const).map(axis => Math.max(...layout.nodes.map(n=>n[axis]))-Math.min(...layout.nodes.map(n=>n[axis])));
  assert(Math.max(...spans)/Math.min(...spans) < 1.2, 'round on every axis');
  assert.equal(new Set(layout.nodes.map(n=>`${n.x>=0},${n.y>=0},${n.z>=0}`)).size,8);
  assert.deepEqual(layout3D({...graph,nodes:[...graph.nodes].reverse()}).nodes,layout.nodes);
  assert.deepEqual(layout.edges,graph.relationships.filter(e=>e.type!=='PARTICIPATES_IN'));
  for(const count of [0,1,2]) {
    const small=layout3D({...graph,nodes:graph.nodes.filter(n=>n.kind==='COMPANY').slice(0,count)});
    assert(small.radius>0 && small.nodes.every(n=>[n.x,n.y,n.z].every(Number.isFinite)));
    assert(small.edges.every(e=>small.nodes.some(n=>n.id===e.source)&&small.nodes.some(n=>n.id===e.target)));
  }
});

test('intro camera glides closer before easing into rotation', () => {
  const advance = createIntroCamera(1000, 480, () => .25);
  let previousDistance = 1000;
  let last = { distance: 1000, azimuth: 0, polar: 0 };
  for (let frame = 1; frame <= 240; frame++) {
    last = advance(.05, Math.PI / 2);
    assert(last.distance <= previousDistance);
    assert(last.distance >= 480);
    // Approach cannot jump more than 0.7% of its starting distance per frame.
    assert(previousDistance - last.distance < 7);
    if (frame <= 159) {
      assert.equal(Math.abs(last.azimuth), 0);
      assert.equal(Math.abs(last.polar), 0);
    }
    if (frame === 1) assert(1000 - last.distance < .01);
    if (frame === 161) {
      assert.equal(last.distance, 480);
      assert(Math.abs(last.azimuth) < .000001);
    }
    previousDistance = last.distance;
  }
  assert.equal(last.distance, 480);
  assert(Math.abs(last.azimuth) > .001);
});

test('intro orbit covers every side and varied elevations without camera jumps', () => {
  for (const random of [() => 0, () => .499, () => .999]) {
    const advance = createIntroOrbit(random);
    let azimuth = 0, polar = Math.PI / 2;
    let minPolar = polar, maxPolar = polar;
    const sides = new Set<number>();
    for (let frame = 0; frame < 600 * 20; frame++) {
      const step = advance(.05, polar);
      assert(Math.abs(step.azimuth) <= 2.3 * Math.PI / 180 * .05);
      assert(Math.abs(step.polar) <= 1.2 * Math.PI / 180 * .05);
      azimuth += step.azimuth;
      polar += step.polar;
      minPolar = Math.min(minPolar, polar);
      maxPolar = Math.max(maxPolar, polar);
      sides.add(Math.floor(((azimuth % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)));
      assert(polar >= 55 * Math.PI / 180 && polar <= 125 * Math.PI / 180);
    }
    assert.equal(sides.size, 4);
    assert(minPolar < 85 * Math.PI / 180);
    assert(maxPolar > 95 * Math.PI / 180);
    const resumed = advance(60, polar);
    assert(Math.abs(resumed.azimuth) <= 2.3 * Math.PI / 180 * .05);
    assert(Math.abs(resumed.polar) <= 1.2 * Math.PI / 180 * .05);
  }
});

const graphs: Graph[] = ["ai-us", "ai-cn-a"].map(id => JSON.parse(readFileSync(new URL(`../data/ai-supply-chain/${id}.json`, import.meta.url), "utf8")));
test('five-layer tree retains every company and distinguishes models from cloud infrastructure',()=>{
  const companies=graphs.flatMap(g=>g.nodes.filter(n=>n.kind==='COMPANY')) as GraphNode[];
  companies.push({id:'ORG:OPENAI',kind:'COMPANY',order:0,stageIds:['applications']},{id:'UNKNOWN',kind:'COMPANY',order:0,stageIds:['future-role']});
  const layers=industryTree([...companies,companies[0]]);
  assert.deepEqual(layers.map(l=>l.id),['energy','chips','infrastructure','models','applications']);
  assert.equal(new Set(layers.flatMap(l=>l.companies.map(c=>c.id))).size,companies.length);
  for(const layer of layers)assert.equal(new Set(layer.companies.map(c=>c.id)).size,layer.companies.length);
  const models=layers.find(l=>l.id==='models')!.companies.map(c=>c.id);
  assert(models.includes('ORG:OPENAI'));assert(models.includes('US:GOOGL'));assert(!models.includes('US:CRWV'));assert(!models.includes('US:ORCL'));
  assert(layers.find(l=>l.id==='applications')!.branches.find(b=>b.id.endsWith('/other'))!.companies.some(c=>c.id==='UNKNOWN'));
  const overview=layoutIndustryTree(layers,new Set(['root']),'en');
  assert.equal(overview.length,6);
  const heights=overview.filter(n=>n.kind==='layer').map(n=>n.position[1]);
  assert(heights.every((y,i)=>!i||y>heights[i-1]));
  const expanded=layoutIndustryTree(layers,new Set(['root','chips','chips/compute']),'en');
  assert(expanded.some(n=>n.company?.id==='US:NVDA'));assert(!expanded.some(n=>n.company?.id==='US:ORCL'));
  assert.equal(layoutIndustryTree(layers,new Set(),'en').length,1);
});
test('tree siblings align vertically and expanded descendants reserve space between layers',()=>{
  const layers=industryTree(graphs.flatMap(g=>g.nodes.filter(n=>n.kind==='COMPANY')) as GraphNode[]);
  const open=new Set(['root','applications']);
  const branches=layoutIndustryTree(layers,open,'en');
  const siblings=branches.filter(n=>n.kind==='branch'&&n.layer==='applications');
  assert.equal(siblings.length,2);
  assert.equal(siblings[0].parent,siblings[1].parent);
  assert.equal(siblings[0].position[0],siblings[1].position[0]);
  assert.equal(siblings[0].position[2],siblings[1].position[2]);
  assert(siblings[0].position[1]>siblings[1].position[1]);
  const expanded=layoutIndustryTree(layers,new Set([...open,'applications/applications']),'en');
  const children=expanded.filter(n=>n.parent==='applications/applications');
  assert(children.length>1);
  assert(children.every(n=>n.position[0]>siblings[0].position[0]&&n.position[0]===children[0].position[0]));
  const other=expanded.find(n=>n.id==='applications/edge')!;
  assert(children.every(n=>n.position[1]>other.position[1]+46));
  const distance=(nodes:typeof expanded)=>nodes.find(n=>n.id==='applications')!.position[1]-nodes.find(n=>n.id==='models')!.position[1];
  assert(distance(expanded)>distance(branches));
  assert.deepEqual(layoutIndustryTree(layers,open,'en'),branches);
  const all=layoutIndustryTree(layers,new Set(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]),'en');
  for(const layer of layers){
    const group=all.filter(n=>n.kind==='branch'&&n.layer===layer.id);
    assert(group.every(n=>n.position[0]===100&&n.position[2]===0));
    const ys=all.filter(n=>n.layer===layer.id).map(n=>n.position[1]);
    const next=layers[layers.indexOf(layer)+1];
    if(next)assert(Math.max(...ys)<Math.min(...all.filter(n=>n.layer===next.id).map(n=>n.position[1])));
  }
});
test("both datasets have unique sourced companies, valid topology and honest coverage counts", () => {
  graphs.forEach(validateGraph);
  assert.equal(graphs[0].coverage.companyCount, 67);
  assert.equal(graphs[1].coverage.companyCount, 62);
  assert(graphs[0].nodes.some(n => n.id === "US:P"));
  assert(!graphs[0].nodes.some(n => n.id === "US:PSTG"));
});
test("rejects broken evidence, cross-market endpoints, and commercial stage edges", () => {
  for (const mutation of [
    (g: Graph) => { g.relationships[0].sourceIds = ["missing"]; },
    (g: Graph) => { g.relationships[0].source = "XSHG:688041"; },
    (g: Graph) => { g.relationships[0].type = "SUPPLIER_OF"; },
    (g: Graph) => { g.relationships.push(g.relationships[0]); },
    (g: Graph) => { g.sources[0].url = "https://username:password@example.com"; },
    (g: Graph) => { g.coverage.companyCount++; },
    (g: Graph) => { g.relationships.find(e => e.type === "PLANNED_ADOPTER_OF")!.commercialStatus = "DOCUMENTED"; },
  ]) { const copy = structuredClone(graphs[0]); mutation(copy); assert.throws(() => validateGraph(copy)); }
});
test("new published master relationships bring in public neighbors; drafts, missing endpoints and unrelated companies stay out",()=>{
  const seed={id:"US:NVDA",name:"NVIDIA",status:"PUBLISHED",aiGraph:{status:"PUBLISHED",stageIds:["compute"],stages:[{id:"stage:compute",kind:"STAGE",order:1}],sources:[],memberships:[],order:1,asOf:"2026-09-11"}} as MarketCompany;
  const evidence=[{id:"report",url:"https://example.com/report",title:"Report",sourceDate:null,summary:"Supplies hardware"}];
  const edge={id:"r",source:"US:NVDA",target:"US:NEW",type:"SUPPLIER_OF",status:"PUBLISHED",evidence};
  const companies=[seed,{id:"US:NEW",name:"New company",status:"DIRECTORY"},{id:"US:PRIVATE",name:"Private",status:"DRAFT"},{id:"US:OTHER",name:"Unrelated",status:"PUBLISHED"}];
  const map=graphFromMarket(companies,[edge,{...edge,id:"private",target:"US:PRIVATE"},{...edge,id:"draft",status:"DRAFT",target:"US:OTHER"}]);
  assert.deepEqual(map.nodes.filter(n=>n.kind==="COMPANY").map(n=>n.id),["US:NVDA","US:NEW"]);
  assert.equal(map.relationships.length,1);
  assert.equal(map.sources[0].url,evidence[0].url);
});


test("generic graph membership takes precedence over legacy metadata", async () => {
 const membership = {status:"PUBLISHED" as const,stageIds:["energy"],stages:[],memberships:[],sources:[],order:9,asOf:"2026-09-20"};
 const company = {id:"US:NVDA",name:"NVIDIA",status:"PUBLISHED",inGraph:membership,aiGraph:{...membership,stageIds:["compute"]}};
 assert.deepEqual(graphFromMarket([company],[]).nodes.find(n=>n.id === company.id)?.stageIds,["energy"]);

});


test('vertical tree stacks dependent layers on one trunk and reserves space for every company',()=>{
 const layers=industryTree(graphs.flatMap(g=>g.nodes.filter(n=>n.kind==='COMPANY')) as GraphNode[]);
 const initial=layoutVerticalTree(layers,new Set(['root']),'zh-CN');
 assert.equal(initial.length,6);assert.equal(initial[0].position[0],0);
 assert(initial.slice(1).every(n=>n.position[1]>initial[0].position[1]),'whole-tree title sits below every industry layer');
 const trunks=initial.filter(n=>n.kind==='layer');
 // Energy -> chips -> infrastructure -> models -> applications, bottom to top.
 assert(trunks.every((n,i)=>n.parent==='root'&&(!i||n.position[1]>trunks[i-1].position[1])));
 assert.equal(trunks[0].id,'energy');assert(trunks[0].position[1]<0,'energy grows as roots below ground');
 const crown=trunks.at(-1)!;
 assert.equal(crown.id,'applications');assert.equal(crown.position[0],0);
 // Trunk layers sit on the trunk as contiguous segments, each resting on the one below.
 const stack=trunks.slice(1,-1);
 assert(stack.every(n=>Math.abs(n.position[0])<80&&n.span&&n.position[1]>n.span[0]&&n.position[1]<n.span[1]));
 assert(stack.every((n,i)=>!i||n.span![0]===stack[i-1].span![1]));
 // Check growth rules in each limb's own plane; the rendered limbs wrap around the trunk.
 const all=layoutVerticalTree(layers,new Set(['root',...layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]),'en').map(n=>({...n,position:n.planar??n.position}));
 assert(all.slice(1).every(n=>n.position[1]>all[0].position[1]),'expanded Energy roots stay above the whole-tree title');
 assert.equal(new Set(all.filter(n=>n.company).map(n=>n.company!.id)).size,new Set(layers.flatMap(l=>l.companies.map(c=>c.id))).size);
 assert.equal(new Set(all.map(n=>n.id)).size,all.length);
 const top=Math.max(...all.filter(n=>n.kind==='layer').map(n=>n.position[1]));
 // Limbs grow from their stem, so order layers by where limbs leave the trunk, not by their tips.
 const height=(n:TreePoint)=>n.kind==='branch'?n.stem!:n.position[1];
 const reaches:number[]=[];
 for(const [i,layer] of layers.entries()){
   const group=all.filter(n=>n.layer===layer.id);
   const node=group.find(n=>n.kind==='layer')!;
   if(layer.id==='energy')assert(group.every(n=>n.position[1]<0),'energy stays underground');
   else if(layer.id==='applications')assert(group.filter(n=>n.kind!=='layer').every(n=>n.position[1]>node.position[1]),'application branches grow above the trunk tip');
   else {
     const branches=group.filter(n=>n.kind==='branch');
     assert(branches.every(b=>b.stem!>node.span![0]&&b.stem!<node.span![1]),'branches grow from their own trunk segment');
     if(branches.length>1)assert.equal(new Set(branches.map(b=>Math.sign(b.position[0]))).size,2,'branches grow outward on both sides');
     for(const b of branches){
       const [ox,oy]=verticalBranchOrigin(b,top),tilt=Math.atan2(b.position[1]-oy,Math.abs(b.position[0]-ox))*180/Math.PI;
       assert(tilt>=18&&tilt<=44,`${b.id} leans upward like a limb (${tilt.toFixed(1)}°)`);
     }
     reaches.push(Math.max(...branches.map(b=>{const [ox,oy]=verticalBranchOrigin(b,top);return Math.hypot(b.position[0]-ox,b.position[1]-oy);})));
     // Stable jitter: the two sides are not mirror images.
     const left=branches.filter(b=>b.position[0]<0),right=branches.filter(b=>b.position[0]>0);
     if(left.length&&right.length)assert(!left.some(l=>right.some(r=>Math.abs(l.position[0]+r.position[0])<1&&Math.abs(l.position[1]-r.position[1])<1)));
   }
   const next=layers[i+1];
   if(next)assert(Math.max(...group.filter(n=>n.kind!=='company').map(height))<Math.min(...all.filter(n=>n.layer===next.id&&n.kind!=='company').map(height)));
   for(const branch of layer.branches){
     const children=all.filter(n=>n.parent===branch.id);
     const parent=all.find(n=>n.id===branch.id)!;
     const [ox,oy]=verticalBranchOrigin(parent,top),dx=parent.position[0]-ox,dy=parent.position[1]-oy,length=Math.hypot(dx,dy);
     assert.equal(new Set(children.map(n=>n.position.join(','))).size,children.length);
     if(layer.id==='energy'){
       assert(children.every(n=>n.position[1]<0),'independent company roots stay underground');
       continue;
     }
     assert(children.every(n=>Math.sign(n.position[0])===Math.sign(parent.position[0])));
     // Leaves spread over the outer part of their limb and out past its tip, fanning wider
     // towards the end instead of bunching against the trunk.
     const offsets:number[]=[];
     for(const n of children){
       const along=((n.position[0]-ox)*dx+(n.position[1]-oy)*dy)/length**2,off=Math.abs((n.position[0]-ox)*dy-(n.position[1]-oy)*dx)/length;
       assert(along>(layer.id==='applications'?.35:.55)&&along<1.35&&off<260,`${n.id} grows along its limb`);
       offsets.push(along);
     }
     if(children.length>3)assert(Math.max(...offsets)>1,`${branch.id} leaves reach past the limb tip`);
     if(layer.id==='applications')assert(children.every(n=>n.position[1]>oy));
   }
 }
 // Lower limbs reach furthest, so the canopy tapers to a crown.
 assert(reaches.every((r,i)=>!i||r<reaches[i-1]),`limb reach tapers upward: ${reaches.map(Math.round)}`);
 assert.deepEqual(layoutVerticalTree(layers,new Set(['root']),'zh-CN'),initial);
 assert.equal(layoutVerticalTree(layers,new Set(),'en').length,1);
});

test('tour speed scales movement while long frames stay bounded',()=>{
 const slow=createIntroOrbit(()=>.5),fast=createIntroOrbit(()=>.5);
 assert(Math.abs(fast(.02,Math.PI/2,2).azimuth/slow(.02,Math.PI/2,.5).azimuth-4)<1e-9);
 const one=createIntroCamera(1000,500,()=>.5),two=createIntroCamera(1000,500,()=>.5);
 let normal=1000,quick=1000;
 for(let i=0;i<80;i++){normal=one(.05,Math.PI/2,1).distance;quick=two(.05,Math.PI/2,2).distance;}
 assert(quick<normal);assert.equal(quick,500);
});
