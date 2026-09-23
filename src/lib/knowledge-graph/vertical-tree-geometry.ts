import { AdditiveBlending, BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, NormalBlending, Points, PointsMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import type { TreePoint } from './industry-tree';
import { VERTICAL_ROOT_REACH, verticalTrunkX } from './vertical-tree';

// Framework-free geometry for the vertical tree. The React scene and offline
// previews share it, so what we review is exactly what ships.
//
// The trunk is the dependency stack: energy roots feed a trunk whose segments
// are chips, infrastructure and models, each growing out of the one below and
// joined by a soft growth ring. Every segment sends its own branches outward;
// the applications crown sits on top. Colours blend only near each seam, so a
// layer reads as one band while the trunk still reads as one living thing.
const segments=40;
const TRUNK_HALF_WIDTH=100;
const SEAM_BLEND=60;
type Kind='trunk'|'fiber'|'root'|'ring'|'branch'|'twig';
type Attach='trunk'|'root'|'crown';
type RGBA=[number,number,number,number];
export type Strand={from:string;to:string;kind:Kind;width:[number,number];offset:number;color:(t:number)=>RGBA;layer?:string;branch?:string;end?:[number,number];attach?:Attach};
type XY={x:number;y:number};

// Half-width of the trunk at a height fraction: a flared base settling into a
// steady taper that still carries weight up to the crown.
const trunkHalf=(t:number)=>TRUNK_HALF_WIDTH*(.34+.66*Math.pow(1-Math.min(1,Math.max(0,t)),1.05))+TRUNK_HALF_WIDTH*.75*Math.pow(Math.max(0,1-t/.07),2);

function gradient(stops:[number,Color][]){
  return (t:number)=>{
    const i=Math.max(0,stops.findIndex(([at])=>at>=t)-1),[a,ca]=stops[i],[b,cb]=stops[Math.min(stops.length-1,i+1)];
    return ca.clone().lerp(cb,b>a?Math.min(1,Math.max(0,(t-a)/(b-a))):0);
  };
}
const rgba=(c:Color,a:number):RGBA=>[c.r,c.g,c.b,a];
const mix=(a:Color|string,b:Color|string,t:number)=>new Color(a).lerp(new Color(b),Math.min(1,Math.max(0,t)));
const ease=(t:number)=>t*t*(3-2*t);
// Trunk bands are a deeper, richer version of the layer colour.
const bark=(hex:string)=>mix(hex,'#0b2a45',.3);

export function verticalTreeStrands(nodes:TreePoint[]):Strand[]{
  const layers=nodes.filter(n=>n.kind==='layer');
  const roots:Strand[]=[],limbs:Strand[]=[],trunk:Strand[]=[],crown:Strand[]=[],twigs:Strand[]=[];
  if(!layers.length)return [];
  const top=Math.max(1,...layers.map(l=>l.position[1]));
  const energy=layers.find(l=>l.id==='energy'),crownLayer=layers.find(l=>l.id==='applications')??layers[layers.length-1];
  const stack=layers.filter(l=>l!==energy&&l!==crownLayer&&l.span).sort((a,b)=>a.span![0]-b.span![0]);
  const gold=new Color(energy?.color??'#f4db7c');
  // Colour stops along the trunk height: energy at the flare, then each layer's
  // band, blending only within SEAM_BLEND of each seam.
  const stops:[number,Color][]=[[0,bark(gold.getStyle())]];
  const seams:number[]=[];
  stack.forEach((layer,i)=>{
    const [lo,hi]=layer.span!;
    stops.push([Math.max(0,lo+SEAM_BLEND*(i?1:.6))/top,bark(layer.color)]);
    if(i)seams.push(lo);
    stops.push([(hi-SEAM_BLEND)/top,bark(layer.color)]);
  });
  if(stack.length)seams.push(stack[stack.length-1].span![1]);
  stops.push([1,bark(crownLayer.color)]);
  const trunkColor=gradient(stops);
  // The trunk dissolves into its roots at the base instead of ending in a cut.
  const base=(t:number)=>ease(Math.min(1,t/.045));
  trunk.push({from:'root',to:crownLayer.id,kind:'trunk',width:[1,1],offset:0,color:t=>rgba(trunkColor(t),.97*base(t))});
  // Inner light fibres follow the trunk silhouette like grain.
  for(const f of [-.7,-.44,-.18,.1,.36,.62])trunk.push({from:'root',to:crownLayer.id,kind:'fiber',width:[1.4,.7],offset:f,color:t=>rgba(mix(trunkColor(t),'#f2fbff',.5),.26*(1-t*.5)*base(t))});
  // Growth rings mark where one layer rests on the next.
  for(const y of seams)trunk.push({from:'root',to:crownLayer.id,kind:'ring',width:[2.4,2.4],offset:0,end:[y,0],color:t=>rgba(new Color('#eaf8ff'),.42*Math.sin(Math.PI*t))});
  // Energy roots: thick at the flare, hairline and fading at the tips.
  const count=9;
  for(let side=-1;side<=1;side+=2)for(let i=0;i<count;i++){
    const s=(i+.5)/count,wobble=Math.sin((i+1)*(side+3)*12.9898)*.5+.5;
    const x=side*VERTICAL_ROOT_REACH*(.16+.8*Math.pow(s,.95))*(.92+wobble*.1);
    const y=-(60+220*Math.pow(1-s,1.2)+wobble*50);
    const deep=bark(gold.getStyle());
    roots.push({from:'root',to:'root',kind:'root',width:[16*(1-s)+5,.4],offset:side*(.25+.6*s),end:[x,y],color:t=>rgba(mix(deep,gold,t*.8),.92*Math.pow(1-t,1.3))});
  }
  const byId=new Map(nodes.map(n=>[n.id,n]));
  for(const n of nodes){
    if(!n.parent||n.kind==='layer')continue;
    const tint=new Color(n.color),light=mix(tint,'#ffffff',.35);
    if(n.kind==='branch'){
      const parent=byId.get(n.parent);
      const attach:Attach=parent===energy?'root':parent===crownLayer?'crown':'trunk';
      const base=attach==='trunk'?trunkColor(Math.min(1,Math.max(0,(n.position[1]-150)/top))):attach==='root'?bark(gold.getStyle()):bark(crownLayer.color);
      const strand:Strand={from:n.parent,to:n.id,kind:'branch',width:[attach==='trunk'?0:15,3.2],offset:0,attach,end:parent?.span,layer:n.layer,branch:n.branch,color:t=>rgba(mix(base,light,ease(Math.min(1,t*1.3))),.97)};
      (attach==='trunk'?limbs:crown).push(strand);
    }else twigs.push({from:n.parent,to:n.id,kind:'twig',width:[1.3,.45],offset:0,layer:n.layer,branch:n.branch,color:t=>rgba(mix(tint,light,t),.8-.45*t)});
  }
  // Draw order: limbs tuck in behind the trunk so they appear to grow out of
  // it; roots spill over the trunk base; crown branches and twigs sit on top.
  return [...limbs,...trunk,...roots,...crown,...twigs];
}

export function verticalTreeStrandGeometries(strands:Strand[],focus:string){
  return [0,1].map(glow=>{
    // The glow is two half-ribbons per segment whose outer edge is transparent,
    // so halos fade softly instead of ending in a hard band.
    const per=glow?12:6;
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(strands.length*segments*per*3),3));
    const colors=new Float32Array(strands.length*segments*per*4);
    strands.forEach((s,index)=>{
      const dim=focus&&(s.kind==='branch'||s.kind==='twig')&&s.layer!==focus&&s.branch!==focus?.18:1;
      const glowAlpha=glow?(s.kind==='trunk'?.22:s.kind==='branch'?.2:s.kind==='root'?.12:0):1;
      for(let step=0;step<segments;step++){
        const p=s.color(step/segments),q=s.color((step+1)/segments);
        // Vertex order matches the position writer. Main: p+, p-, q+, p-, q-, q+.
        // Glow: p, p+, q, p+, q+, q then the same on the minus side (edge alpha 0).
        const order=glow?[[p,1],[p,0],[q,1],[p,0],[q,0],[q,1],[p,1],[p,0],[q,1],[p,0],[q,0],[q,1]] as const:[[p,1],[p,1],[q,1],[p,1],[q,1],[q,1]] as const;
        order.forEach(([c,edge],v)=>colors.set([c[0],c[1],c[2],c[3]*dim*glowAlpha*edge],((index*segments+step)*per+v)*4));
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
    const color=mix(node.color,'#ffffff',.4);
    for(let i=0;i<2;i++){
      const seed=node.id.length*31.7+node.position[0]*.013+i*91.3,angle=random(seed)*Math.PI*2,r=18+random(seed+1)*34;
      positions.push(node.position[0]+Math.cos(angle)*r,node.position[1]+Math.sin(angle)*r,-3);colors.push(...color.toArray());
    }
  }
  if(nodes.some(n=>n.kind==='layer'))for(let i=0;i<80;i++){
    const u=random(i*12.7+3)*2-1,depth=random(i*7.1+1);
    positions.push(u*VERTICAL_ROOT_REACH*.9,-30-depth*260*(1-Math.abs(u)*.5),-3);
    colors.push(...new Color(i%3?'#b89a4a':'#f4db7c').toArray());
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
    const tx=(y:number)=>verticalTrunkX(y,top);
    strands.forEach((strand,index)=>{
      const source=positionOf(strand.from),target=positionOf(strand.to);if(!source||!target)return;
      a.set(source.x,source.y,-4);b.set(target.x,target.y,-4);
      let startHalf=0;
      if(strand.kind==='trunk'||strand.kind==='fiber'||strand.kind==='ring'){a.set(0,0,-4);b.set(0,top,-4);}
      if(strand.kind==='branch'){
        const side=Math.sign(b.x-tx(b.y))||1;
        if(strand.attach==='trunk'){
          // Leave the trunk from inside this layer's own segment, a little
          // below the branch so it grows up and out.
          const [lo,hi]=strand.end??[0,top];
          const lift=200+120*Math.abs(Math.sin(b.x*.013));
          const y=Math.min(hi-50,Math.max(lo+50,b.y-lift));
          startHalf=trunkHalf(y/top)*.5;
          a.set(tx(y)+side*trunkHalf(y/top)*.35,y,-4);
        }else if(strand.attach==='root'){a.set(side*40,-40,-4);startHalf=strand.width[0];}
        else {a.set(0,top+20,-4);startHalf=strand.width[0];}
      }
      const end=strand.end;
      const bezier=(t:number,out:Vector3,c1x:number,c1y:number,c2x:number,c2y:number)=>{
        const u=1-t;return out.set(u*u*u*a.x+3*u*u*t*c1x+3*u*t*t*c2x+t*t*t*b.x,u*u*u*a.y+3*u*u*t*c1y+3*u*t*t*c2y+t*t*t*b.y,-4);
      };
      const point=(t:number,out:Vector3)=>{
        if(strand.kind==='trunk')return out.set(tx(top*t),top*t-30*(1-t),-4);
        if(strand.kind==='fiber')return out.set(tx(top*t)+strand.offset*trunkHalf(t)*(1-.1*t),top*t,-4);
        if(strand.kind==='ring'&&end){
          const y=end[0],hw=trunkHalf(y/top)*1.04;
          return out.set(tx(y)-hw+2*hw*t,y-9*Math.sin(Math.PI*t),-3);
        }
        if(strand.kind==='root'&&end){
          // Cubic from the trunk flare: down first, then outward along the soil.
          const u=1-t,x0=strand.offset*TRUNK_HALF_WIDTH*.9,x1=strand.offset*TRUNK_HALF_WIDTH*2.4+end[0]*.08,x2=end[0]*.62;
          const y0=60,y1=end[1]*.7,y2=end[1]*1.05;
          return out.set(u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*end[0],u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*end[1],-4);
        }
        const dx=b.x-a.x,dy=b.y-a.y;
        if(strand.kind==='branch'&&strand.attach==='trunk')return bezier(t,out,a.x+dx*.12,a.y+Math.max(60,dy*.95),b.x-dx*.45,b.y);
        if(strand.kind==='branch'&&strand.attach==='root')return bezier(t,out,a.x+dx*.12,a.y+dy*.85,b.x-dx*.4,b.y);
        if(strand.kind==='branch')return bezier(t,out,a.x+dx*.08,a.y+dy*.8,b.x-dx*.3,b.y);
        return bezier(t,out,a.x+dx*.22,a.y+dy*.15,b.x-dx*.35,b.y);
      };
      const normal=(at:number,out:Vector3)=>{
        point(Math.max(0,at-.001),before);point(Math.min(1,at+.001),after);
        const dx=after.x-before.x,dy=after.y-before.y;
        return out.set(-dy,dx,0).divideScalar(Math.hypot(dx,dy)||1);
      };
      const half=(t:number)=>{
        if(strand.kind==='trunk')return trunkHalf(t);
        if(strand.kind==='branch')return strand.width[1]+(startHalf-strand.width[1])*Math.pow(1-t,1.8);
        const [w0,w1]=strand.width;return w1+(w0-w1)*Math.pow(1-t,1.2);
      };
      for(let step=0;step<segments;step++){
        const t=step/segments,t1=(step+1)/segments;point(t,p);point(t1,q);
        normal(t,normalP);normal(t1,normalQ);
        const wp=half(t),wq=half(t1);
        geometries.forEach((g,glow)=>{
          const pos=g.getAttribute('position');
          if(!glow){
            const nx=normalP.x*wp,ny=normalP.y*wp,qx=normalQ.x*wq,qy=normalQ.y*wq,base=(index*segments+step)*6;
            pos.setXYZ(base,p.x+nx,p.y+ny,p.z);pos.setXYZ(base+1,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+2,q.x+qx,q.y+qy,q.z);
            pos.setXYZ(base+3,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+4,q.x-qx,q.y-qy,q.z);pos.setXYZ(base+5,q.x+qx,q.y+qy,q.z);
            return;
          }
          const k=strand.kind==='trunk'?1.5:2.6,base=(index*segments+step)*12;
          for(const [sign,o] of [[1,0],[-1,6]] as const){
            const nx=normalP.x*wp*k*sign,ny=normalP.y*wp*k*sign,qx=normalQ.x*wq*k*sign,qy=normalQ.y*wq*k*sign;
            pos.setXYZ(base+o,p.x,p.y,p.z);pos.setXYZ(base+o+1,p.x+nx,p.y+ny,p.z);pos.setXYZ(base+o+2,q.x,q.y,q.z);
            pos.setXYZ(base+o+3,p.x+nx,p.y+ny,p.z);pos.setXYZ(base+o+4,q.x+qx,q.y+qy,q.z);pos.setXYZ(base+o+5,q.x,q.y,q.z);
          }
        });
      }
    });
    geometries.forEach(g=>{g.getAttribute('position').needsUpdate=true;});
  };
}

// Static scene objects: ground glow, ribbon meshes and dust points.
export function verticalTreeObjects(geometries:BufferGeometry[],dust:BufferGeometry):Object3D[]{
  // Stacked soft discs give the soil glow a gradual falloff without a hard rim.
  const ground=[1,.72,.48,.28].map((s,i)=>{
    const mesh=new Mesh(new SphereGeometry(90,40,16),new MeshBasicMaterial({color:i<2?'#3fa9e8':'#e8c96a',transparent:true,opacity:.022,depthWrite:false,blending:AdditiveBlending}));
    mesh.position.set(0,-110,-8-i);mesh.scale.set(VERTICAL_ROOT_REACH/90*.9*s,2.4*s,1);return mesh;
  });
  const ribbons=geometries.map((geometry,glow)=>{
    const mesh=new Mesh(geometry,new MeshBasicMaterial({vertexColors:true,side:DoubleSide,transparent:true,depthWrite:false,blending:glow?AdditiveBlending:NormalBlending}));
    mesh.frustumCulled=false;mesh.renderOrder=glow?-3:-2;return mesh;
  });
  const points=new Points(dust,new PointsMaterial({vertexColors:true,size:5,map:dotTexture(),sizeAttenuation:false,transparent:true,opacity:.7,depthWrite:false,blending:AdditiveBlending}));
  points.frustumCulled=false;
  return [...ground,...ribbons,points];
}

// Leaf and knot styling for node spheres in the vertical view.
export function verticalTreeNodeStyle(node:TreePoint,dim:boolean,capScale=1){
  const radius=node.kind==='company'?3.2*capScale:node.kind==='layer'?11:node.kind==='branch'?8:10;
  return {radius,core:dim?.12:.95,glow:dim?.01:node.kind==='company'?.16:.12,glowRadius:radius*(node.kind==='company'?3.4:2.8)};
}
