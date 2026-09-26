import type { TreePoint } from './industry-tree';

type Point = [number, number, number];
export type TreeShot = { target: Point; position: Point };
const ease = (t: number) => t*t*t*(t*(t*6-15)+10);
const mix = (a: Point, b: Point, t: number): Point => a.map((v,i)=>v+(b[i]-v)*t) as Point;

// Visit every visible company in small neighbouring groups, rather than letting
// a random orbit linger at one height. Labels stay front-facing during the tour.
export function treeTourStops(nodes: TreePoint[]): Point[] {
  const companies=nodes.filter(n=>n.kind==='company');
  const candidates=companies.length?companies:nodes.filter(n=>n.kind==='branch');
  const groups=new Map<string,TreePoint[]>();
  for(const node of candidates){const key=node.branch??node.id;groups.set(key,[...(groups.get(key)??[]),node]);}
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

export function createTreeTour(start:TreeShot, stops:Point[], aspect:number, random:()=>number=Math.random){
  let elapsed=0,index=0,from=start;
  const direction=random()<.5?-1:1;
  let fromYaw=Math.atan2(start.position[0]-start.target[0],start.position[2]-start.target[2]);
  let toYaw=fromYaw+direction*.35;
  // Keep circling in one direction while climbing through the canopy.
  const shot=(target:Point):TreeShot=>{
    const yaw=toYaw,pitch=(random()-.5)*.14;
    const distance=Math.max(1000,Math.min(1650,1050/Math.sqrt(Math.max(.4,aspect))));
    return {target,position:[target[0]+Math.sin(yaw)*distance,target[1]+pitch*distance,target[2]+Math.cos(yaw)*distance]};
  };
  let to=shot(stops[0]??start.target);
  return (delta:number):TreeShot=>{
    elapsed+=Math.max(0,Math.min(.05,delta));
    // Slow approach, then a short hold to read the company names.
    const duration=index===0?12:20,hold=5;
    const t=ease(Math.min(1,elapsed/duration));
    const target=mix(from.target,to.target,t);
    const fromRadius=Math.hypot(from.position[0]-from.target[0],from.position[2]-from.target[2]);
    const toRadius=Math.hypot(to.position[0]-to.target[0],to.position[2]-to.target[2]);
    const radius=fromRadius+(toRadius-fromRadius)*t,yaw=fromYaw+(toYaw-fromYaw)*t;
    const lift=(from.position[1]-from.target[1])*(1-t)+(to.position[1]-to.target[1])*t;
    const current={target,position:[target[0]+Math.sin(yaw)*radius,target[1]+lift,target[2]+Math.cos(yaw)*radius] as Point};
    if(elapsed>=duration+hold){
      elapsed=0;from=to;fromYaw=toYaw;toYaw+=direction*(.5+random()*.15);index++;to=shot(stops[index%Math.max(1,stops.length)]??start.target);
    }
    return current;
  };
}
