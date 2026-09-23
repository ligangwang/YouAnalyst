import { companyName } from './model';
import type { TreeLayer, TreePoint } from './industry-tree';

export const VERTICAL_ROOT_REACH=1400;
export const VERTICAL_ROOT_DEPTH=600;
// Energy is underground: it feeds the whole trunk, so it grows as roots.
const ROOT_LAYERS=new Set(['energy']);
const CROWN_LAYER='applications';

// The trunk sways gently and returns to centre at the base and the crown.
export function verticalTrunkX(y:number,top:number){
  const t=Math.min(1,Math.max(0,y/Math.max(top,1)));
  return Math.sin(t*Math.PI*1.6-.25)*70*Math.sin(t*Math.PI)*.9;
}

// The layers depend on one another, so the trunk is a stack: roots (energy)
// feed chips, which carry infrastructure, which carries models, which carry the
// application crown. Every trunk layer is a segment of the trunk and grows its
// own branches outward on both sides; companies are the leaves.
export function layoutVerticalTree(layers:TreeLayer[],open:ReadonlySet<string>,locale:string):TreePoint[] {
  const label=(n:{en:string;zh:string})=>locale==='zh-CN'?n.zh:n.en;
  const nodes:TreePoint[]=[{id:'root',kind:'root',label:locale==='zh-CN'?'AI 产业链':'AI industry chain',color:'#8be8ff',position:[0,0,0]}];
  if(!open.has('root'))return nodes;
  const leaves=(layer:TreeLayer,branch:TreeLayer['branches'][number],bx:number,by:number,side:number,up:number)=>{
    if(!open.has(branch.id))return;
    [...branch.companies].sort((a,b)=>a.id.localeCompare(b.id)).forEach((company,j)=>{
      const angle=j*2.399963229728653,radius=40+Math.sqrt(j+1)*30;
      nodes.push({id:`${branch.id}/${company.id}`,parent:branch.id,layer:layer.id,branch:branch.id,kind:'company',label:companyName(company,locale),color:layer.color,
        position:[bx+side*(290+radius*1.1*Math.cos(angle)),by+up+radius*Math.sin(angle)*.9,0],company});
    });
  };
  let bottom=150;
  for(const layer of layers){
    const expanded=open.has(layer.id);
    if(ROOT_LAYERS.has(layer.id)){
      const y=-420;
      nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:label(layer),color:layer.color,position:[0,y,0],count:layer.companies.length,span:[-VERTICAL_ROOT_DEPTH,0]});
      if(expanded)layer.branches.forEach((branch,i)=>{
        const side=i%2?-1:1,k=Math.floor(i/2);
        const bx=side*(900+k*180),by=-470-k*70;
        nodes.push({id:branch.id,parent:layer.id,layer:layer.id,branch:branch.id,kind:'branch',label:label(branch),color:layer.color,position:[bx,by,0],count:branch.companies.length});
        leaves(layer,branch,bx,by,side,-20);
      });
      continue;
    }
    if(layer.id===CROWN_LAYER){
      const y=bottom+340;
      nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:label(layer),color:layer.color,position:[0,y,0],count:layer.companies.length,span:[bottom,y]});
      if(expanded)layer.branches.forEach((branch,i)=>{
        const offset=i-(layer.branches.length-1)/2,side=Math.sign(offset)||(i%2?-1:1);
        const bx=offset*1500||side*750,by=y+430-Math.abs(offset)*40;
        nodes.push({id:branch.id,parent:layer.id,layer:layer.id,branch:branch.id,kind:'branch',label:label(branch),color:layer.color,position:[bx,by,0],count:branch.companies.length});
        leaves(layer,branch,bx,by,side,160);
      });
      continue;
    }
    // Branches alternate sides and climb the segment, so each side reads as a
    // sequence of limbs growing from that layer's part of the trunk.
    const perSide=Math.ceil(layer.branches.length/2);
    const height=expanded?Math.max(480,perSide*185+220):400;
    const y=bottom+height/2;
    nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:label(layer),color:layer.color,position:[0,y,0],count:layer.companies.length,span:[bottom,bottom+height]});
    if(expanded)layer.branches.forEach((branch,i)=>{
      // Sides are staggered and reaches vary, so limbs read as grown, not combed.
      const side=i%2?1:-1,k=Math.floor(i/2),step=(height-230)/perSide;
      const by=Math.min(bottom+height-70,bottom+140+(k+.5)*step+(side>0?step*.45:0));
      const jitter=Math.sin((i+1)*12.9898+layer.id.length*78.233)*43758.5453;
      const bx=side*(880+420*(jitter-Math.floor(jitter)));
      nodes.push({id:branch.id,parent:layer.id,layer:layer.id,branch:branch.id,kind:'branch',label:label(branch),color:layer.color,position:[bx,by,0],count:branch.companies.length});
      leaves(layer,branch,bx,by,side,30);
    });
    bottom+=height;
  }
  // The trunk sways; keep every trunk layer label on the trunk itself.
  const top=Math.max(1,...nodes.filter(n=>n.kind==='layer').map(n=>n.position[1]));
  for(const n of nodes)if(n.kind==='layer'&&!ROOT_LAYERS.has(n.id)&&n.id!==CROWN_LAYER)n.position[0]=verticalTrunkX(n.position[1],top);
  return nodes;
}
