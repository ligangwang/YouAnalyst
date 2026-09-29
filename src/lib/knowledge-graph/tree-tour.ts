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

export const TREE_PRESENTATION = { overview: 4, reveal: 3, settle: 2, orbit: 60, ascent: 8, return: 30 } as const;
export type TreePresentationFrame = {shot:TreeShot;phase:'overview'|'reveal'|'orbit'|'ascent'|'return';layer:string;revealLayers:string[];angle:number;elevation:number};

// A fixed-distance orbit around the whole tree. The small change in elevation
// gives each layer its own turn without ever aiming a close-up at the trunk.
export function createTreePresentation(overview:TreeShot,stops:TreeTourStop[]) {
  let elapsed=0;
  const n=stops.length, growth=TREE_PRESENTATION.overview+n*TREE_PRESENTATION.reveal+TREE_PRESENTATION.settle;
  const cycle=n*TREE_PRESENTATION.orbit+Math.max(0,n-1)*TREE_PRESENTATION.ascent+TREE_PRESENTATION.return;
  const sample=():TreePresentationFrame=>{
    const revealLayers=stops.filter((_,i)=>elapsed>=TREE_PRESENTATION.overview+i*TREE_PRESENTATION.reveal).map(s=>s.layer);
    const base={shot:overview,phase:'overview' as TreePresentationFrame['phase'],layer:'',revealLayers,angle:0,elevation:0};
    if(!n||elapsed<TREE_PRESENTATION.overview)return base;
    if(elapsed<growth)return {...base,phase:'reveal',layer:stops[Math.min(n-1,Math.floor((elapsed-TREE_PRESENTATION.overview)/TREE_PRESENTATION.reveal))].layer};
    let t=(elapsed-growth)%cycle,index=0,angle=0,elevation=0,phase:TreePresentationFrame['phase']='orbit';
    const height=(i:number)=>n<2?0:i/(n-1)*.16;
    for(;index<n;index++){
      if(t<TREE_PRESENTATION.orbit){angle=index*Math.PI*2.25+2*Math.PI*ease(t/TREE_PRESENTATION.orbit);elevation=height(index);break;}
      t-=TREE_PRESENTATION.orbit;
      if(index<n-1){
        if(t<TREE_PRESENTATION.ascent){const k=ease(t/TREE_PRESENTATION.ascent);angle=index*Math.PI*2.25+Math.PI*2+k*Math.PI*.25;elevation=height(index)+(height(index+1)-height(index))*k;phase='ascent';break;}
        t-=TREE_PRESENTATION.ascent;
      }
    }
    if(index===n){const k=ease(t/TREE_PRESENTATION.return);index=n-1;const endAngle=((n-1)*2.25+2)*Math.PI;angle=endAngle+(Math.ceil(endAngle/(Math.PI*2))*Math.PI*2-endAngle)*k;elevation=height(n-1)*(1-k);phase='return';}
    const distance=overview.position[2]-overview.target[2],radius=distance*Math.cos(elevation);
    const shot:TreeShot={target:overview.target,position:[overview.target[0]+radius*Math.sin(angle),overview.target[1]+distance*Math.sin(elevation),overview.target[2]+radius*Math.cos(angle)]};
    return {...base,shot,phase,layer:stops[index].layer,angle,elevation};
  };
  return Object.assign((delta:number,speed=1)=>{elapsed+=tourDelta(delta,speed);return sample();},{sample,reframe:(shot:TreeShot)=>{overview=shot;}});
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
