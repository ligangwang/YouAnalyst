import { companyName } from './model';
import type { TreeLayer, TreePoint } from './industry-tree';

export const VERTICAL_ROOT_REACH=1000;
export const VERTICAL_ROOT_DEPTH=600;
// Energy is underground: it feeds the whole trunk, so it grows as roots.
const ROOT_LAYERS=new Set(['energy']);
const CROWN_LAYER='applications';

// The trunk sways gently and returns to centre at the base and the crown.
export function verticalTrunkX(y:number,top:number){
  const t=Math.min(1,Math.max(0,y/Math.max(top,1)));
  return Math.sin(t*Math.PI*1.6-.25)*70*Math.sin(t*Math.PI)*.9;
}

// Stable pseudo-random value in [0,1) per id, so the tree is irregular but
// identical on every render.
export function verticalJitter(id:string,salt=0){
  let seed=salt*7919;for(const c of id)seed=(seed*31+c.charCodeAt(0))|0;
  const v=Math.sin(seed*.0001+seed%977)*43758.5453;return v-Math.floor(v);
}

// Where a limb leaves the trunk. Branch tips carry `stem`, the height they grow
// from; roots and the crown have fixed attachment points.
export function verticalBranchOrigin(branch:TreePoint,top:number):[number,number]{
  const side=Math.sign((branch.planar??branch.position)[0])||1,stem=branch.stem??0;
  if(ROOT_LAYERS.has(branch.layer??''))return [side*40,-40];
  if(branch.layer===CROWN_LAYER)return [0,stem];
  return [verticalTrunkX(stem,top)+side*30,stem];
}

// A limb's curve: it rises out of the trunk, then eases outward along its lean.
// Shared by the layout and the renderer so things placed on a limb sit on it.
export function verticalLimbControls(ax:number,ay:number,bx:number,by:number):[number,number,number,number]{
  const dx=bx-ax,dy=by-ay;
  return [ax+dx*.18,ay+dy*.45,bx-dx*.38,by-dy*.12];
}
export function verticalLimbPoint([ax,ay]:[number,number],[bx,by]:[number,number],t:number):[number,number]{
  const [c1x,c1y,c2x,c2y]=verticalLimbControls(ax,ay,bx,by),u=1-t;
  return [u*u*u*ax+3*u*u*t*c1x+3*u*t*t*c2x+t*t*t*bx,u*u*u*ay+3*u*u*t*c1y+3*u*t*t*c2y+t*t*t*by];
}

// The layers depend on one another, so the trunk is a stack: roots (energy)
// feed chips, which carry infrastructure, which carries models, which carry the
// application crown. Every trunk layer is a segment of the trunk and grows its
// own limbs up and outward; companies are the leaves along each limb's outer half.
export function layoutVerticalTree(layers:TreeLayer[],open:ReadonlySet<string>,locale:string):TreePoint[] {
  const label=(n:{en:string;zh:string})=>locale==='zh-CN'?n.zh:n.en;
  // The whole-tree title belongs below the underground Energy layer. Keep its
  // anchor in the layout so camera fitting includes the title on small screens.
  const nodes:TreePoint[]=[{id:'root',kind:'root',label:locale==='zh-CN'?'AI 产业链':'AI industry chain',color:'#8be8ff',position:[0,-VERTICAL_ROOT_DEPTH-320,0]}];
  if(!open.has('root'))return nodes;
  // A limb from its trunk origin at an upward angle; leaves grow along its
  // outer half and a little past the tip, alternating sides of the limb.
  const limb=(layer:TreeLayer,branch:TreeLayer['branches'][number],origin:[number,number],side:number,reach:number,angle:number,stem:number)=>{
    const bx=origin[0]+side*reach*Math.cos(angle),by=origin[1]+reach*Math.sin(angle);
    nodes.push({id:branch.id,parent:layer.id,layer:layer.id,branch:branch.id,kind:'branch',label:label(branch),color:layer.color,position:[bx,by,0],count:branch.companies.length,stem});
    if(!open.has(branch.id))return;
    const dx=bx-origin[0],dy=by-origin[1],length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length;
    const companies=[...branch.companies].sort((a,b)=>a.id.localeCompare(b.id));
    companies.forEach((company,j)=>{
      const id=`${branch.id}/${company.id}`,wobble=verticalJitter(id,3);
      let position:[number,number,number];
      if(ROOT_LAYERS.has(layer.id)){
        // Roots carry no leaves: energy companies are nodules sitting on the root strand itself.
        const t=.3+.65*(j+.35+.3*wobble)/companies.length;
        const [x,y]=verticalLimbPoint(origin,[bx,by],t);
        position=[x,y,0];
      }else{
        // Leaves start past the limb's middle and run beyond its tip, fanning wider towards the end,
        // so clusters spread outward into one canopy instead of bunching against the trunk.
        // The crown's few limbs start a little lower and fan wider, so the top rounds into a cap.
        const crown=layer.id===CROWN_LAYER,from=crown?.4:.62;
        const t=from+(1.3-from)*(j+.3+.4*wobble)/companies.length;
        const flank=(j%2?1:-1)*(42+80*verticalJitter(id,5))*(crown?1.3:1)*(.65+.55*t);
        position=[origin[0]+dx*t-uy*flank,origin[1]+dy*t+ux*flank,0];
      }
      nodes.push({id,parent:branch.id,layer:layer.id,branch:branch.id,kind:'company',label:companyName(company,locale),color:layer.color,position,company});
    });
  };
  // Lower limbs reach furthest and upper ones less, so the canopy tapers to a
  // rounded crown instead of a rectangle.
  const stack=layers.filter(l=>!ROOT_LAYERS.has(l.id)&&l.id!==CROWN_LAYER).map(l=>l.id);
  const tierReach=(id:string)=>id===CROWN_LAYER?470:660-85*Math.max(0,stack.indexOf(id));
  let bottom=150;
  for(const layer of layers){
    const expanded=open.has(layer.id);
    if(ROOT_LAYERS.has(layer.id)){
      const y=-420;
      nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:label(layer),color:layer.color,position:[0,y,0],count:layer.companies.length,span:[-VERTICAL_ROOT_DEPTH,0]});
      if(expanded)layer.branches.forEach((branch,i)=>{
        const side=i%2?-1:1,k=Math.floor(i/2),jitter=verticalJitter(branch.id);
        limb(layer,branch,[side*40,-40],side,(520+k*120)*(.9+.2*jitter),-(.42+.12*jitter+k*.06),-40);
      });
      continue;
    }
    if(layer.id===CROWN_LAYER){
      const y=bottom+220;
      nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:label(layer),color:layer.color,position:[0,y,0],count:layer.companies.length,span:[bottom,y]});
      if(expanded)layer.branches.forEach((branch,i)=>{
        const offset=i-(layer.branches.length-1)/2,side=Math.sign(offset)||(i%2?-1:1),jitter=verticalJitter(branch.id);
        // The crown's limbs spread from the trunk tip into a dome.
        const angle=(44-8*Math.min(1,Math.abs(offset)/2)+(jitter-.5)*10)*Math.PI/180;
        limb(layer,branch,[0,y+20],side,tierReach(layer.id)*(.88+.24*jitter),angle,y+20);
      });
      continue;
    }
    // Limbs alternate sides and climb the segment; stems stay in the layer's
    // own part of the trunk while the tips lean up into the canopy.
    const perSide=Math.ceil(layer.branches.length/2);
    const step=125;
    const height=expanded?Math.max(360,perSide*step+200):400;
    const y=bottom+height/2;
    nodes.push({id:layer.id,parent:'root',layer:layer.id,kind:'layer',label:label(layer),color:layer.color,position:[0,y,0],count:layer.companies.length,span:[bottom,bottom+height]});
    if(expanded)layer.branches.forEach((branch,i)=>{
      const side=i%2?1:-1,k=Math.floor(i/2);
      const stem=Math.min(bottom+height-60,bottom+90+k*step+(side>0?step*.5:0)+(verticalJitter(branch.id,2)-.5)*30);
      // Higher limbs within a layer are a little shorter, continuing the taper.
      const climb=perSide>1?k/(perSide-1):0,jitter=verticalJitter(branch.id);
      const reach=tierReach(layer.id)*(1-.14*climb)*(.86+.28*jitter);
      // Limbs lean steeper the higher they grow, as on a real crown.
      const tier=Math.max(0,stack.indexOf(layer.id));
      const angle=Math.min(42,19+7*tier+6*climb+8*verticalJitter(branch.id,1))*Math.PI/180;
      limb(layer,branch,[side*30,stem],side,reach,angle,stem);
    });
    bottom+=height;
  }
  // The trunk sways; keep every trunk layer label on the trunk itself.
  const top=Math.max(1,...nodes.filter(n=>n.kind==='layer').map(n=>n.position[1]));
  for(const n of nodes)if(n.kind==='layer'&&!ROOT_LAYERS.has(n.id)&&n.id!==CROWN_LAYER)n.position[0]=verticalTrunkX(n.position[1],top);
  // Limbs follow the sway too, so each one leaves the trunk where it really is.
  for(const branch of nodes)if(branch.kind==='branch'&&branch.stem!==undefined&&!ROOT_LAYERS.has(branch.layer!)&&branch.layer!==CROWN_LAYER){
    const shift=verticalTrunkX(branch.stem,top);
    for(const n of nodes)if(n===branch||n.parent===branch.id)n.position[0]+=shift;
  }
  // A golden-angle spiral grows limbs around the full trunk, not just its left
  // and right edges. Preserve each limb's local plane for its curved wood and leaves.
  const branchOrder=layers.flatMap(l=>l.branches.map(b=>b.id));
  for(const branch of nodes.filter(n=>n.kind==='branch')){
    const [pivotX]=verticalBranchOrigin(branch,top);
    const side=Math.sign(branch.position[0]-pivotX)||1;
    const azimuth=branchOrder.indexOf(branch.id)*Math.PI*(3-Math.sqrt(5))-(side<0?Math.PI:0);
    for(const node of nodes.filter(n=>n===branch||n.parent===branch.id)){
      node.planar=[...node.position];node.azimuth=azimuth;node.pivotX=pivotX;
      const radial=node.position[0]-pivotX;
      node.position=[pivotX+radial*Math.cos(azimuth),node.position[1],-radial*Math.sin(azimuth)];
    }
  }
  // Energy companies share a category, not a physical root. Give each company
  // an independent root around the trunk while retaining its semantic parent.
  const energyCompanies=nodes.filter(n=>n.kind==='company'&&ROOT_LAYERS.has(n.layer??'')).sort((a,b)=>a.id.localeCompare(b.id));
  energyCompanies.forEach((node,i)=>{
    const azimuth=Math.PI/6+i*2*Math.PI/energyCompanies.length;
    const reach=480+100*verticalJitter(node.id,11),depth=-240-100*verticalJitter(node.id,12);
    node.planar=[reach,depth,0];node.azimuth=azimuth;node.pivotX=0;
    node.position=[reach*Math.cos(azimuth),depth,-reach*Math.sin(azimuth)];
  });
  return nodes;
}
