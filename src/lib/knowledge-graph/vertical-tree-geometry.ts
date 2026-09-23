import { AdditiveBlending, BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, NormalBlending, Points, PointsMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import type { TreePoint } from './industry-tree';
import { VERTICAL_ROOT_REACH } from './vertical-tree';

// Framework-free geometry for the vertical tree. The React scene and offline
// previews share it, so what we review is exactly what ships.
//
// The tree is drawn as one continuous organism: a tapered trunk whose colour
// flows from the roots (cyan) to the application crown (pink), limbs that grow
// out of the trunk body and inherit its colour before turning into their layer
// colour, and hairline twigs that fade toward each company leaf.
const segments=40;
const TRUNK_HALF_WIDTH=96;
const TRUNK_SWAY=70;
type Kind='trunk'|'fiber'|'root'|'limb'|'branch'|'twig';
type RGBA=[number,number,number,number];
export type Strand={from:string;to:string;kind:Kind;width:[number,number];offset:number;color:(t:number)=>RGBA;layer?:string;branch?:string;end?:[number,number]};
type XY={x:number;y:number};

const trunkX=(y:number,top:number)=>{
  const t=Math.min(1,Math.max(0,y/Math.max(top,1)));
  return Math.sin(t*Math.PI*1.6-.25)*TRUNK_SWAY*Math.sin(t*Math.PI)*.9;
};
// Half-width of the trunk at a height fraction: a flared base settling into a
// steady taper that still carries weight up to the crown.
const trunkHalf=(t:number)=>TRUNK_HALF_WIDTH*(.32+.68*Math.pow(1-t,1.1))+TRUNK_HALF_WIDTH*1.3*Math.pow(Math.max(0,1-t/.1),2);

const trunkStops:[number,string][]=[[0,'#1583cf'],[.35,'#2aa9ef'],[.68,'#62c6f5'],[.86,'#c6a9ee'],[1,'#ff9eae']];
function gradient(stops:[number,string][]){
  const colors=stops.map(([at,hex])=>[at,new Color(hex)] as const);
  const scratch=new Color();
  return (t:number)=>{
    const i=Math.max(0,colors.findIndex(([at])=>at>=t)-1),[a,ca]=colors[i],[b,cb]=colors[Math.min(colors.length-1,i+1)];
    return scratch.copy(ca).lerp(cb,b>a?(t-a)/(b-a):0).clone();
  };
}
const trunkColor=gradient(trunkStops);
const rgba=(c:Color,a:number):RGBA=>[c.r,c.g,c.b,a];
const mix=(a:Color,b:Color,t:number)=>a.clone().lerp(b,Math.min(1,Math.max(0,t)));
const ease=(t:number)=>t*t*(3-2*t);

export function verticalTreeStrands(nodes:TreePoint[]):Strand[]{
  const layers=nodes.filter(n=>n.kind==='layer');
  const top=Math.max(1,...layers.map(l=>l.position[1]));
  const roots:Strand[]=[],limbs:Strand[]=[],trunk:Strand[]=[],crown:Strand[]=[];
  if(layers.length){
    const crownId=layers.find(l=>l.id==='applications')?.id??layers[layers.length-1].id;
    trunk.push({from:'root',to:crownId,kind:'trunk',width:[1,1],offset:0,color:t=>rgba(trunkColor(t),.94)});
    // Inner light fibres follow the trunk silhouette instead of bulging out of it.
    for(const f of [-.72,-.46,-.2,.08,.34,.6])trunk.push({from:'root',to:crownId,kind:'fiber',width:[1.5,.8],offset:f,color:t=>rgba(mix(trunkColor(t),new Color('#e6fbff'),.55),.34*(1-t*.55))});
    // Roots dive, then spread: thick near the flare, hairline and fading at the tips.
    const count=11;
    for(let side=-1;side<=1;side+=2)for(let i=0;i<count;i++){
      const s=(i+.5)/count,wobble=Math.sin((i+1)*(side+3)*12.9898)*.5+.5;
      const x=side*VERTICAL_ROOT_REACH*(.14+.72*Math.pow(s,.9))*(0.92+wobble*.12);
      const y=-(70+250*Math.pow(1-s,1.3)+wobble*40);
      const deep=new Color(i%3?'#1d8fd8':'#4fc3f7');
      roots.push({from:'root',to:'root',kind:'root',width:[14*(1-s)+5,.35],offset:side*(.25+.6*s),end:[x,y],color:t=>rgba(mix(deep,new Color('#9be7ff'),t*.6),.9*Math.pow(1-t,1.4))});
    }
  }
  for(const n of nodes.filter(n=>n.parent)){
    if(n.id==='applications')continue;
    const tint=new Color(n.color),light=mix(tint,new Color('#ffffff'),.35);
    if(n.kind==='layer'){
      const base=trunkColor(Math.min(1,Math.max(0,(n.position[1]-260)/top)));
      limbs.push({from:'root',to:n.id,kind:'limb',width:[0,7],offset:0,layer:n.layer,color:t=>rgba(mix(base,tint,ease(Math.min(1,t*1.5))),.96)});
    }else if(n.kind==='branch'){
      (n.parent==='applications'?crown:limbs).push({from:n.parent!,to:n.id,kind:'branch',width:[7,2.6],offset:0,layer:n.layer,branch:n.branch,color:t=>rgba(mix(tint,light,t),.95)});
    }else{
      crown.push({from:n.parent!,to:n.id,kind:'twig',width:[1.25,.45],offset:0,layer:n.layer,branch:n.branch,color:t=>rgba(mix(tint,light,t),.8-.45*t)});
    }
  }
  // Draw order matters with transparent ribbons: limbs tuck in behind the
  // trunk so they appear to grow out of it, twigs sit on top.
  return [...roots,...limbs,...trunk,...crown];
}

export function verticalTreeStrandGeometries(strands:Strand[],focus:string){
  return [0,1].map(glow=>{
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(strands.length*segments*18),3));
    const colors=new Float32Array(strands.length*segments*24);
    strands.forEach((s,index)=>{
      const dim=focus&&(s.kind==='limb'||s.kind==='branch'||s.kind==='twig')&&s.layer!==focus&&s.branch!==focus?.18:1;
      const glowAlpha=glow?(s.kind==='trunk'?.12:s.kind==='branch'?.07:0):1;
      for(let step=0;step<segments;step++){
        const p=s.color(step/segments),q=s.color((step+1)/segments);
        // Vertex order matches the position writer: p+, p-, q+, p-, q-, q+.
        [p,p,q,p,q,q].forEach((c,v)=>colors.set([c[0],c[1],c[2],c[3]*dim*glowAlpha],((index*segments+step)*6+v)*4));
      }
    });
    geometry.setAttribute('color',new Float32BufferAttribute(colors,4));
    return geometry;
  });
}

// Soft round sprite so pollen and soil sparkles are not square pixels.
function dotTexture(){
  const size=32,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const d=Math.hypot(x-size/2+.5,y-size/2+.5)/(size/2),a=Math.max(0,1-d);
    data.set([255,255,255,Math.round(255*a*a)],(y*size+x)*4);
  }
  const texture=new DataTexture(data,size,size);texture.needsUpdate=true;return texture;
}

export function verticalTreeDust(nodes:TreePoint[]){
  const geometry=new BufferGeometry();
  const positions:number[]=[],colors:number[]=[];
  const random=(seed:number)=>{const v=Math.sin(seed)*43758.5453;return v-Math.floor(v);};
  // A little pollen around each leaf keeps canopies alive without clutter.
  for(const node of nodes)if(node.kind==='company'){
    const color=mix(new Color(node.color),new Color('#ffffff'),.4);
    for(let i=0;i<2;i++){
      const seed=node.id.length*31.7+node.position[0]*.013+i*91.3,angle=random(seed)*Math.PI*2,r=18+random(seed+1)*34;
      positions.push(node.position[0]+Math.cos(angle)*r,node.position[1]+Math.sin(angle)*r,-3);colors.push(...color.toArray());
    }
  }
  if(nodes.some(n=>n.kind==='layer'))for(let i=0;i<90;i++){
    const u=random(i*12.7+3)*2-1,depth=random(i*7.1+1);
    positions.push(u*VERTICAL_ROOT_REACH*.85,-40-depth*240*(1-Math.abs(u)*.6),-3);
    colors.push(...new Color(i%4?'#2f8fcf':'#8fdcff').toArray());
  }
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  return geometry;
}

export function createStrandWriter(){
  const a=new Vector3(),b=new Vector3(),p=new Vector3(),q=new Vector3(),before=new Vector3(),after=new Vector3(),normalP=new Vector3(),normalQ=new Vector3();
  // Rewrites ribbon vertices from current node positions (they animate).
  return (strands:Strand[],geometries:BufferGeometry[],positionOf:(id:string)=>XY|undefined,layerYs:number[])=>{
    if(!positionOf('root'))return;
    const top=Math.max(1,...layerYs);
    strands.forEach((strand,index)=>{
      const source=positionOf(strand.from),target=positionOf(strand.to);if(!source||!target)return;
      a.set(source.x,source.y,-4);b.set(target.x,target.y,-4);
      let attach=0;
      if(strand.kind==='trunk'||strand.kind==='fiber'){a.set(0,0,-4);b.set(0,top,-4);}
      if(strand.kind==='limb'){
        const y=Math.max(60,b.y-260);attach=y/top;a.set(trunkX(y,top),y,-4);
      }
      const end=strand.end;
      const point=(t:number,out:Vector3)=>{
        if(strand.kind==='trunk')return out.set(trunkX(b.y*t,top),b.y*t,-4);
        if(strand.kind==='fiber')return out.set(trunkX(b.y*t,top)+strand.offset*trunkHalf(t)*(1-.1*t),b.y*t,-4);
        if(strand.kind==='root'&&end){
          // Cubic from the trunk flare: down first, then outward along the soil.
          const u=1-t,x0=strand.offset*TRUNK_HALF_WIDTH*.9,x1=strand.offset*TRUNK_HALF_WIDTH*2.4+end[0]*.08,x2=end[0]*.62;
          const y0=40,y1=end[1]*.7,y2=end[1]*1.05;
          return out.set(u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*end[0],u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*end[1],-4);
        }
        const u=1-t,dx=b.x-a.x,dy=b.y-a.y;
        // Limbs leave the trunk rising, then level out toward their layer.
        const c1x=strand.kind==='limb'?a.x+dx*.08:a.x+dx*.22,c1y=strand.kind==='limb'?a.y+Math.max(60,dy*.75):a.y+(strand.kind==='twig'?dy*.15:0);
        const c2x=b.x-dx*(strand.kind==='limb'?.5:.35),c2y=b.y;
        return out.set(u*u*u*a.x+3*u*u*t*c1x+3*u*t*t*c2x+t*t*t*b.x,u*u*u*a.y+3*u*u*t*c1y+3*u*t*t*c2y+t*t*t*b.y,-4);
      };
      const normal=(at:number,out:Vector3)=>{
        point(Math.max(0,at-.001),before);point(Math.min(1,at+.001),after);
        const dx=after.x-before.x,dy=after.y-before.y;
        return out.set(-dy,dx,0).divideScalar(Math.hypot(dx,dy)||1);
      };
      const half=(t:number)=>{
        if(strand.kind==='trunk')return trunkHalf(t);
        if(strand.kind==='limb'){
          // Start as wide as the trunk body so the junction reads as growth.
          const base=trunkHalf(attach)*.62;return strand.width[1]+(base-strand.width[1])*Math.pow(1-t,1.7);
        }
        const [w0,w1]=strand.width;return w1+(w0-w1)*Math.pow(1-t,1.2);
      };
      for(let step=0;step<segments;step++){
        const t=step/segments,t1=(step+1)/segments;point(t,p);point(t1,q);
        normal(t,normalP);normal(t1,normalQ);
        const wp=half(t),wq=half(t1);
        geometries.forEach((g,glow)=>{
          const k=glow?(strand.kind==='trunk'?1.7:2.4):1;
          const nx=normalP.x*wp*k,ny=normalP.y*wp*k,qx=normalQ.x*wq*k,qy=normalQ.y*wq*k;
          const pos=g.getAttribute('position'),base=(index*segments+step)*6;
          pos.setXYZ(base,p.x+nx,p.y+ny,p.z);pos.setXYZ(base+1,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+2,q.x+qx,q.y+qy,q.z);
          pos.setXYZ(base+3,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+4,q.x-qx,q.y-qy,q.z);pos.setXYZ(base+5,q.x+qx,q.y+qy,q.z);
        });
      }
    });
    geometries.forEach(g=>{g.getAttribute('position').needsUpdate=true;});
  };
}

// Static scene objects: ground glow, ribbon meshes and dust points.
export function verticalTreeObjects(geometries:BufferGeometry[],dust:BufferGeometry):Object3D[]{
  const ground=new Mesh(new SphereGeometry(90,32,16),new MeshBasicMaterial({color:'#3fb4ff',transparent:true,opacity:.09,depthWrite:false,blending:AdditiveBlending}));
  ground.position.set(0,-40,-8);ground.scale.set(4.2,.9,1);
  const ribbons=geometries.map((geometry,glow)=>{
    const mesh=new Mesh(geometry,new MeshBasicMaterial({vertexColors:true,side:DoubleSide,transparent:true,depthWrite:false,blending:glow?AdditiveBlending:NormalBlending}));
    mesh.frustumCulled=false;mesh.renderOrder=glow?-3:-2;return mesh;
  });
  const points=new Points(dust,new PointsMaterial({vertexColors:true,size:5,map:dotTexture(),sizeAttenuation:false,transparent:true,opacity:.7,depthWrite:false,blending:AdditiveBlending}));
  points.frustumCulled=false;
  return [ground,...ribbons,points];
}

// Leaf and knot styling for node spheres in the vertical view.
export function verticalTreeNodeStyle(node:TreePoint,dim:boolean,capScale=1){
  const radius=node.kind==='company'?3.2*capScale:node.kind==='layer'?11:node.kind==='branch'?8:10;
  return {radius,core:dim?.12:.95,glow:dim?.01:node.kind==='company'?.16:.12,glowRadius:radius*(node.kind==='company'?3.4:2.8)};
}
