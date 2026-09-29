import { TOUR_MOTION, tourDelta, tourEase } from './tour-motion';
import type { TreePoint } from './industry-tree';
import { VERTICAL_ROOT_REACH, VERTICAL_ROOT_DEPTH } from './vertical-tree';

type Point = [number, number, number];
export type TreeShot = { target: Point; position: Point };
const ease = tourEase;
const mix = (a: Point, b: Point, t: number): Point => a.map((v,i)=>v+(b[i]-v)*t) as Point;

// Visit every visible company in small neighbouring groups, rather than letting
// a random orbit linger at one height. Labels stay front-facing during the tour.
export function treeTourStops(nodes: TreePoint[]): Point[] {
  const companies=nodes.filter(n=>n.kind==='company');
  const candidates=companies.length?companies:nodes.filter(n=>n.kind==='branch');
  const groups=new Map<string,TreePoint[]>();
  for(const node of candidates){const key=node.layer==='energy'?node.id:node.branch??node.id;groups.set(key,[...(groups.get(key)??[]),node]);}
  const stops:Point[]=[];
  for(const group of groups.values()){
    group.sort((a,b)=>a.position[1]-b.position[1]||a.id.localeCompare(b.id));
    for(let i=0;i<group.length;i+=4){
      const chunk=group.slice(i,i+4);
      stops.push([0,1,2].map(axis=>chunk.reduce((sum,n)=>sum+n.position[axis],0)/chunk.length) as Point);
    }
  }
  return stops.sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
}

export type TreeTourStop = { target: Point; distance: number; duration: number; hold: number; kind: 'company'|'overview'|'transfer'; layer: string };

// Frame the eventual canopy from the first frame, including front-facing leaves.
// Growing a new layer must never trigger another fit or a close-up.
export function treeOverviewShot(nodes:TreePoint[],width:number,height:number):TreeShot {
  const xs=[-VERTICAL_ROOT_REACH,VERTICAL_ROOT_REACH,...nodes.map(n=>n.position[0])];
  const ys=[-VERTICAL_ROOT_DEPTH,...nodes.map(n=>n.position[1])];
  const target:Point=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2,0];
  const tanV=Math.tan(Math.PI/8)*Math.max(.2,(height-100)/height);
  const tanH=Math.tan(Math.PI/8)*Math.max(120,width-100)/height;
  const points:Point[]=[...nodes.map(n=>n.position),[-VERTICAL_ROOT_REACH,-VERTICAL_ROOT_DEPTH,0],[VERTICAL_ROOT_REACH,0,0]];
  target[0]=0;
  const distance=Math.max(500,...points.map(p=>{
    const r=Math.hypot(p[0],p[2])+110,h=Math.abs(p[1]-target[1])+110;
    return Math.max(r/tanH,(h+r*.16)/tanV)+r+h*.16;
  }));
  return {target,position:[target[0],target[1],distance]};
}

export function treeOverviewPlan(nodes:TreePoint[],open?:ReadonlySet<string>):TreeTourStop[] {
  if(open&&!open.has('root'))return [];
  return nodes.filter(n=>n.kind==='layer'&&(!open||open.has(n.id)))
    .sort((a,b)=>a.position[1]-b.position[1])
    .map(n=>({target:n.position,distance:0,duration:3,hold:0,kind:'overview',layer:n.id}));
}

// One layer every three shared tour seconds, independent of company count.
// The camera stays where it is, including after a user's pan or zoom.
export function createTreeOverviewTour(start:TreeShot,stops:TreeTourStop[]) {
  let elapsed=0,index=0;
  return Object.assign((delta:number,speed=1):TreeShot=>{
    if(stops.length){
      elapsed+=tourDelta(delta,speed);
      while(elapsed>=stops[index].duration){elapsed-=stops[index].duration;index=(index+1)%stops.length;}
    }
    return start;
  },{destination:()=>stops[index]});
}

export const TREE_PRESENTATION = { overview: 4, approach: 8, reveal: 3, company: 4, ascent: 6 } as const;
export type TreePresentationFrame = {shot:TreeShot;phase:'overview'|'approach'|'reveal'|'orbit'|'ascent'|'descent';layer:string;companyId:string;revealLayers:string[];angle:number;elevation:number};

// One close camera distance throughout the visit. Every company gets an explicit
// stop; a dense layer takes longer rather than silently skipping its companies.
export function createTreePresentation(overview:TreeShot,stops:TreeTourStop[],nodes:TreePoint[]=[],aspect=1) {
  let elapsed=0;
  const distance=Math.min((overview.position[2]-overview.target[2])*.55,Math.max(1000,1100/Math.sqrt(Math.max(.35,aspect))));
  type Pose={target:Point;angle:number};
  type Segment={from:Pose;to:Pose;duration:number;moveDuration:number;phase:TreePresentationFrame['phase'];layer:string;companyId:string;revealed:string[]};
  const segments:Segment[]=[],revealed:string[]=[];
  let pose:Pose={target:stops[0]?.target??overview.target,angle:0};
  const add=(to:Pose,duration:number,phase:Segment['phase'],layer:string,companyId='')=>{
    const moveDuration=phase==='reveal'?duration:Math.max(companyId?duration*.6:duration,Math.abs(to.angle-pose.angle)*1.875/.15,Math.hypot(...to.target.map((v,i)=>v-pose.target[i]))*1.875/300);
    segments.push({from:pose,to,duration:moveDuration+(companyId?1.6:0),moveDuration,phase,layer,companyId,revealed:[...revealed]});pose=to;
  };
  const visitLayer=(layer:TreeTourStop,startAngle:number,phase:'ascent'|'descent',grow=false)=>{
    if(grow)revealed.push(layer.layer);
    if(pose.target!==layer.target||pose.angle!==startAngle)add({target:layer.target,angle:startAngle},TREE_PRESENTATION.ascent,phase,layer.layer);
    if(grow)add(pose,TREE_PRESENTATION.reveal,'reveal',layer.layer);
    const companies=nodes.filter(n=>n.kind==='company'&&n.layer===layer.layer).map(node=>({node,angle:((Math.atan2(node.position[0],node.position[2])-startAngle)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)})).sort((a,b)=>a.angle-b.angle||a.node.id.localeCompare(b.node.id));
    for(const {node,angle} of companies)add({target:node.position,angle:startAngle+angle},TREE_PRESENTATION.company,'orbit',layer.layer,node.id);
    if(companies.length||stops.length===1)add({target:layer.target,angle:startAngle+Math.PI*2},TREE_PRESENTATION.company,'orbit',layer.layer);
  };
  for(let i=0;i<stops.length;i++)visitLayer(stops[i],pose.angle+(i?Math.PI*.25:0),'ascent',true);
  const total=segments.reduce((sum,s)=>sum+s.duration,0),introCount=segments.length;
  const lastLayer=stops.at(-1)?.layer??'',loopStartAngle=pose.angle;
  // A round trip adds one full transfer turn, so every loop joins at exactly
  // the same crown pose without reversing rotation or resetting the camera.
  const transferAngle=Math.PI/Math.max(1,stops.length-1);
  for(let i=stops.length-2;i>=0;i--)visitLayer(stops[i],pose.angle+transferAngle,'descent');
  for(let i=1;i<stops.length;i++)visitLayer(stops[i],pose.angle+transferAngle,'ascent');
  if(stops.length===1)visitLayer(stops[0],pose.angle,'ascent');
  const loopSegments=segments.splice(introCount);
  const loopDuration=loopSegments.reduce((sum,s)=>sum+s.duration,0),loopAngle=pose.angle-loopStartAngle;
  const closeShot=(p:Pose):TreeShot=>({target:p.target,position:[p.target[0]+distance*Math.sin(p.angle),p.target[1]+distance*.08,p.target[2]+distance*Math.cos(p.angle)]});
  const first:Pose={target:stops[0]?.target??overview.target,angle:0};
  const sample=():TreePresentationFrame=>{
    const base={shot:overview,phase:'overview' as TreePresentationFrame['phase'],layer:'',companyId:'',revealLayers:[] as string[],angle:0,elevation:0};
    if(!stops.length||elapsed<TREE_PRESENTATION.overview)return base;
    let t=elapsed-TREE_PRESENTATION.overview;
    if(t<TREE_PRESENTATION.approach){const k=ease(t/TREE_PRESENTATION.approach),close=closeShot(first);return {...base,phase:'approach',layer:stops[0].layer,shot:{position:mix(overview.position,close.position,k),target:mix(overview.target,close.target,k)}};}
    t-=TREE_PRESENTATION.approach;
    let list=segments,loops=0;
    // After the first ascent, descend to the roots and ascend again at the same distance.
    if(t>=total&&loopDuration){loops=Math.floor((t-total)/loopDuration);t=(t-total)%loopDuration;list=loopSegments;}
    for(const segment of list){
      if(t<segment.duration){
        const k=ease(Math.min(1,t/segment.moveDuration));
        const angle=segment.from.angle+(segment.to.angle-segment.from.angle)*k+loops*loopAngle;
        const target=mix(segment.from.target,segment.to.target,k);
        return {...base,shot:closeShot({target,angle}),phase:segment.phase,layer:segment.layer,companyId:segment.companyId,revealLayers:segment.revealed,angle,elevation:target[1]};
      }
      t-=segment.duration;
    }
    return {...base,shot:closeShot(pose),phase:'orbit',layer:lastLayer,revealLayers:[...revealed],angle:pose.angle,elevation:pose.target[1]};
  };
  return Object.assign((delta:number,speed=1)=>{elapsed+=tourDelta(delta,speed);return sample();},{sample,duration:()=>TREE_PRESENTATION.overview+TREE_PRESENTATION.approach+total,loopDuration:()=>loopDuration,reframe:(shot:TreeShot)=>{overview=shot;}});
}

// Keep layer membership explicit: leaves from adjacent layers can overlap in height.
// Pull back first, travel along the trunk at that wider distance, then approach
// the next company. The final transfer descends to Energy and the plan repeats.
export function treeTourPlan(nodes:TreePoint[], aspect:number, open?:ReadonlySet<string>):TreeTourStop[]{
  if(open&&!open.has('root'))return [];
  const layers=nodes.filter(n=>n.kind==='layer'&&(!open||open.has(n.id))).sort((a,b)=>a.position[1]-b.position[1]||a.id.localeCompare(b.id));
  const distance=Math.max(1000,Math.min(1650,1050/Math.sqrt(Math.max(.4,aspect))));
  const plan:TreeTourStop[]=[];
  for(let i=0;i<layers.length;i++){
    const layer=layers[i],next=layers[(i+1)%layers.length];
    const stops=treeTourStops(nodes.filter(n=>n.layer===layer.id));
    for(const target of stops.length?stops:[layer.position]){
      plan.push({target,distance,duration:TOUR_MOTION.group,hold:TOUR_MOTION.hold,kind:'company',layer:layer.id});
    }
    // Frame the connecting trunk and neighboring layer anchors, without returning
    // to the initial whole-tree fit. The longer return gets a slightly wider view.
    const gap=Math.abs(next.position[1]-layer.position[1]);
    const wide=Math.max(distance*2.1,(gap*.55+400)/Math.tan(Math.PI/8));
    plan.push({target:[0,layer.position[1],0],distance:wide,duration:TOUR_MOTION.overview,hold:TOUR_MOTION.overviewHold,kind:'overview',layer:layer.id});
    plan.push({target:[0,next.position[1],0],distance:wide,duration:i===layers.length-1?20:14,hold:2,kind:'transfer',layer:next.id});
  }
  return plan;
}

// Start in the user's current layer, or the next open layer above it (wrapping at the crown).
// Only the itinerary changes here; the camera will ease from its untouched current pose.
export function treeTourFromView(plan:TreeTourStop[], view:TreeShot, nodes:TreePoint[], skipLayer?:string):TreeTourStop[]{
  if(!plan.length)return [];
  const layers=nodes.filter(n=>n.kind==='layer').sort((a,b)=>a.position[1]-b.position[1]);
  const y=view.target[1];
  const distance=(n:TreePoint)=>n.span?Math.max(n.span[0]-y,0,y-n.span[1]):Math.abs(n.position[1]-y);
  let current=layers.reduce((best,n,i)=>distance(n)<distance(layers[best])?i:best,0);
  if(skipLayer){const index=layers.findIndex(n=>n.id===skipLayer);if(index>=0)current=(index+1)%layers.length;}
  const isVisit=(stop:TreeTourStop)=>stop.kind==='company'||!plan.some(s=>s.kind==='company');
  let layer=plan[0].layer;
  for(let offset=0;offset<layers.length;offset++){
    const candidate=layers[(current+offset)%layers.length].id;
    if(plan.some(stop=>isVisit(stop)&&stop.layer===candidate)){layer=candidate;break;}
  }
  const candidates=plan.map((stop,index)=>({stop,index})).filter(({stop})=>isVisit(stop)&&stop.layer===layer);
  const squared=(stop:TreeTourStop)=>stop.target.reduce((sum,v,i)=>sum+(v-view.target[i])**2,0);
  const index=candidates.reduce((best,candidate)=>squared(candidate.stop)<squared(best.stop)?candidate:best,candidates[0])?.index??0;
  return [...plan.slice(index),...plan.slice(0,index)];
}

export function createTreeTour(start:TreeShot, stops:TreeTourStop[], random:()=>number=Math.random){
  if(!stops.length)return Object.assign((delta:number)=>{void delta;return start;},{destination:()=>undefined});
  let elapsed=0,index=0,from=start;
  const direction=random()<.5?-1:1;
  let fromYaw=Math.atan2(start.position[0]-start.target[0],start.position[2]-start.target[2]);
  let toYaw=fromYaw+direction*.35;
  // Keep circling in one direction while climbing through the canopy.
  const shot=(stop:TreeTourStop):TreeShot=>{
    const {target,distance}=stop;
    const yaw=toYaw,pitch=stop.kind==='company'?(random()-.5)*.14:0;
    return {target,position:[target[0]+Math.sin(yaw)*distance,target[1]+pitch*distance,target[2]+Math.cos(yaw)*distance]};
  };
  let to=shot(stops[0]);
  const advance=(delta:number,speed=1):TreeShot=>{
    // Keep the slow tour near wall-clock speed on low-frame-rate phones/software
    // renderers. Hidden scenes are paused; cap resume gaps to a quarter second.
    elapsed+=tourDelta(delta,speed);
    // Slow approach, then a short hold to read the company names.
    const stop=stops[index%stops.length];
    const duration=index===0?TOUR_MOTION.approach:stop.duration,hold=stop.hold;
    const t=ease(Math.min(1,elapsed/duration));
    const target=mix(from.target,to.target,t);
    const fromRadius=Math.hypot(from.position[0]-from.target[0],from.position[2]-from.target[2]);
    const toRadius=Math.hypot(to.position[0]-to.target[0],to.position[2]-to.target[2]);
    const radius=fromRadius+(toRadius-fromRadius)*t,yaw=fromYaw+(toYaw-fromYaw)*t;
    const lift=(from.position[1]-from.target[1])*(1-t)+(to.position[1]-to.target[1])*t;
    const current={target,position:[target[0]+Math.sin(yaw)*radius,target[1]+lift,target[2]+Math.cos(yaw)*radius] as Point};
    if(elapsed>=duration+hold){
      elapsed-=duration+hold;from=to;fromYaw=toYaw;index++;
      const next=stops[index%stops.length];
      toYaw+=direction*(next.kind==='company'?TOUR_MOTION.degreesPerSecond*Math.PI/180*next.duration*(.85+random()*.3):.12);
      to=shot(next);
    }
    return current;
  };
  return Object.assign(advance,{destination:()=>stops[index%stops.length]});
}
