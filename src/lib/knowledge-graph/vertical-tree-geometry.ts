import { AdditiveBlending, BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, Points, PointsMaterial, Shape, ShapeGeometry, SphereGeometry, Vector3, type Object3D } from 'three';
import type { TreePoint } from './industry-tree';
import { VERTICAL_ROOT_REACH, verticalBranchOrigin, verticalJitter, verticalLimbControls, verticalTrunkX } from './vertical-tree';

// Framework-free geometry for the vertical tree. The React scene and offline
// previews share it, so what we review is exactly what ships.
//
// The trunk is the dependency stack: energy roots feed a trunk whose segments
// are chips, infrastructure and models, each growing out of the one below and
// joined by a soft growth ring. Every segment sends its own branches outward;
// the applications crown sits on top. Colours blend only near each seam, so a
// layer reads as one band while the trunk still reads as one living thing.
const segments=20;
const sides=8;
const TRUNK_HALF_WIDTH=144;
const SEAM_BLEND=60;
type Kind='trunk'|'fiber'|'root'|'ring'|'branch'|'twig';
type Attach='trunk'|'root'|'crown'|'node';
type RGBA=[number,number,number,number];
export type Strand={from:string;to:string;kind:Kind;width:[number,number];offset:number;color:(t:number)=>RGBA;layer?:string;branch?:string;end?:[number,number];attach?:Attach;stem?:number;azimuth?:number;pivotX?:number};
type XY={x:number;y:number;z?:number};

// Half-width of the trunk at a height fraction: a flared base settling into a
// steady taper that still carries weight up to the crown.
const trunkHalf=(t:number)=>{
  const height=Math.min(1,Math.max(0,t));
  // Start narrowing below the crown so the trunk flows into its upper forks
  // without a thick shoulder followed by an abrupt needle-shaped tip.
  const crown=Math.max(0,(height-.48)/.52);
  const taper=.045+.955*Math.pow(1-crown,1.35);
  return TRUNK_HALF_WIDTH*(.4+.6*Math.pow(1-height,1.05))*taper+TRUNK_HALF_WIDTH*.75*Math.pow(Math.max(0,1-height/.09),2);
};

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
const bark=(hex:string)=>mix('#806044',hex,.09);

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
    const tint=bark(n.color),light=mix(tint,'#c0aa75',.25);
    if(n.kind==='branch'){
      const parent=byId.get(n.parent);
      const attach:Attach=parent===energy?'node':parent===crownLayer?'crown':'trunk';
      const base=attach==='trunk'?trunkColor(Math.min(1,Math.max(0,(n.stem??n.position[1])/top))):parent===energy?bark(gold.getStyle()):bark(crownLayer.color);
      // Bark near the trunk, lightening only towards the tip, so limbs read as wood rather than light pipes.
      const strand:Strand={from:n.parent,to:n.id,kind:'branch',width:parent===energy?[48,32]:[attach==='trunk'?0:12,1.6],offset:0,attach,end:parent?.span,stem:n.stem,layer:n.layer,branch:n.branch,color:t=>rgba(mix(base,light,.75*ease(t)),.97)};
      (attach==='trunk'?limbs:crown).push(strand);
    }else if(n.kind==='company'&&energy&&n.layer===energy.id){
      roots.push({from:n.parent,to:n.id,kind:'branch',attach:'node',width:[32,2.4],offset:0,layer:n.layer,branch:n.branch,color:t=>rgba(mix(bark(gold.getStyle()),light,.75*ease(t)),.97)});
    }else if(n.layer!==energy?.id)twigs.push({from:n.parent,to:n.id,kind:'twig',width:[1.2,.35],offset:0,layer:n.layer,branch:n.branch,color:t=>rgba(mix(light,tint,t),.75-.35*t)});
  }
  // Draw order: limbs tuck in behind the trunk so they appear to grow out of
  // it; roots spill over the trunk base; crown branches and twigs sit on top.
  return [...limbs,...trunk,...roots,...crown,...twigs].map(s=>({...s,azimuth:byId.get(s.to)?.azimuth,pivotX:byId.get(s.to)?.pivotX}));
}

export function verticalTreeStrandGeometries(strands:Strand[],focus:string){
  return [0,1].map(glow=>{
    // The glow is two half-ribbons per segment whose outer edge is transparent,
    // so halos fade softly instead of ending in a hard band.
    const per=glow?12:6*sides;
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(strands.length*segments*per*3),3));
    const colors=new Float32Array(strands.length*segments*per*4);
    strands.forEach((s,index)=>{
      const dim=focus&&(s.kind==='branch'||s.kind==='twig')&&s.layer!==focus&&s.branch!==focus?.18:1;
      const glowAlpha=glow?(s.kind==='root'?.035:0):1;
      for(let step=0;step<segments;step++){
        const p=s.color(step/segments),q=s.color((step+1)/segments);
        // Vertex order matches the position writer. Main: p+, p-, q+, p-, q-, q+.
        // Glow: p, p+, q, p+, q+, q then the same on the minus side (edge alpha 0).
        const order=glow?[[p,1],[p,0],[q,1],[p,0],[q,0],[q,1],[p,1],[p,0],[q,1],[p,0],[q,0],[q,1]] as const:[[p,1],[p,1],[q,1],[p,1],[q,1],[q,1]] as const;
        for(let face=0;face<(glow?1:sides);face++)order.forEach(([c,edge],v)=>colors.set([c[0],c[1],c[2],c[3]*dim*glowAlpha*edge],((index*segments+step)*per+face*order.length+v)*4));
      }
    });
    geometry.setAttribute('color',new Float32BufferAttribute(colors,4));
    if(!glow){
      const uv=new Float32Array(strands.length*segments*per*2);
      strands.forEach((_,index)=>{
        for(let step=0;step<segments;step++)for(let face=0;face<sides;face++){
          const u=face/sides,v=step/segments,du=1/sides,dv=1/segments;
          uv.set([u,v,u+du,v,u,v+dv,u+du,v,u+du,v+dv,u,v+dv],((index*segments+step)*per+face*6)*2);
        }
      });
      geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
    }
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
  // Companies are leaves now, so only the soil keeps its sparkle.
  if(nodes.some(n=>n.kind==='layer'))for(let i=0;i<80;i++){
    const u=random(i*12.7+3)*2-1,depth=random(i*7.1+1);
    positions.push(u*VERTICAL_ROOT_REACH*.9,-30-depth*260*(1-Math.abs(u)*.5),-3);
    colors.push(...new Color(i%3?'#b89a4a':'#f4db7c').toArray());
  }
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  return geometry;
}

type Curve={ax:number;ay:number;az?:number;c1x:number;c1y:number;c2x:number;c2y:number;bx:number;by:number;bz?:number;h0:number;h1:number;bow?:number;taper?:number};
const cubic=(c:Curve,t:number,out:Vector3)=>{
  const u=1-t;
  return out.set(u*u*u*c.ax+3*u*u*t*c.c1x+3*u*t*t*c.c2x+t*t*t*c.bx,u*u*u*c.ay+3*u*u*t*c.c1y+3*u*t*t*c.c2y+t*t*t*c.by,(c.az??0)+((c.bz??0)-(c.az??0))*ease(t)+(c.bow??0)*Math.sin(Math.PI*t)-4);
};
// Limbs taper smoothly from the trunk to a fine tip.
const limbHalf=(c:Curve,t:number)=>c.h1+(c.h0-c.h1)*Math.pow(1-t,c.taper??1.5);

export function createStrandWriter(){
  const p=new Vector3(),q=new Vector3(),before=new Vector3(),after=new Vector3(),normalP=new Vector3(),normalQ=new Vector3(),on=new Vector3();
  const limbs=new Map<string,Curve>();
  // Rewrites ribbon vertices from current node positions (they animate).
  return (strands:Strand[],geometries:BufferGeometry[],positionOf:(id:string)=>XY|undefined,layerYs:number[])=>{
    if(!positionOf('root'))return;
    const top=Math.max(1,...layerYs);
    const tx=(y:number)=>verticalTrunkX(y,top);
    limbs.clear();
    strands.forEach((strand,index)=>{
      const worldSource=positionOf(strand.from),worldTarget=positionOf(strand.to);if(!worldSource||!worldTarget)return;
      const angle=strand.azimuth??0,pivot=strand.pivotX??0;
      const local=(v:XY)=>({x:pivot+(v.x-pivot)*Math.cos(angle)-(v.z??0)*Math.sin(angle),y:v.y,z:(v.x-pivot)*Math.sin(angle)+(v.z??0)*Math.cos(angle)});
      const source=local(worldSource),target=local(worldTarget);
      let curve:Curve|undefined;
      if(strand.kind==='branch'){
        const bx=target.x,by=target.y;
        let ax:number,ay:number,h0:number;
        if(strand.attach==='trunk'){
          // Leave the trunk at the limb's own stem, inside its layer's segment.
          const [lo,hi]=strand.end??[0,top];
          ay=Math.min(hi-30,Math.max(lo+30,strand.stem??by));
          const side=Math.sign(bx-tx(ay))||1;
          h0=trunkHalf(ay/top)*.42;ax=tx(ay)+side*trunkHalf(ay/top)*.35;
        }else if(strand.attach==='node'){ax=source.x;ay=source.y;h0=strand.width[0];}
        else if(strand.attach==='root'){ax=(Math.sign(bx)||1)*40;ay=-40;h0=strand.width[0];}
        else {ay=strand.stem??top-160;ax=tx(ay);h0=trunkHalf(ay/top)*.65;}
        const [c1x,c1y,c2x,c2y]=verticalLimbControls(ax,ay,bx,by,strand.to);
        const reach=Math.hypot(bx-ax,by-ay);
        curve={ax,ay,az:strand.attach==='node'?source.z:0,bx,by,bz:target.z,c1x,c1y,c2x,c2y,
          h0:h0*(.8+.4*verticalJitter(strand.to,25)),h1:strand.width[1],
          bow:reach*(verticalJitter(strand.to,26)-.5)*.22,taper:1.1+verticalJitter(strand.to,27)};
        limbs.set(strand.to,curve);
      }else if(strand.kind==='twig'){
        // Twigs leave their limb where the leaf hangs, not all from its tip.
        const limb=limbs.get(strand.from);
        if(limb){
          const cx=limb.bx-limb.ax,cy=limb.by-limb.ay;
          const along=Math.min(1,Math.max(.05,((target.x-limb.ax)*cx+(target.y-limb.ay)*cy)/(cx*cx+cy*cy||1)));
          cubic(limb,along,on);
          const dx=target.x-on.x,dy=target.y-on.y;
          const h0=Math.max(.8,limbHalf(limb,along)*.5);
          curve={ax:on.x,ay:on.y,az:on.z+4,bx:target.x,by:target.y,bz:target.z,c1x:on.x+dx*.25+cx*.06,c1y:on.y+dy*.25+cy*.06,c2x:target.x-dx*.3,c2y:target.y-dy*.3,h0,h1:strand.width[1]};
        }else{
          const dx=target.x-source.x,dy=target.y-source.y;
          curve={ax:source.x,ay:source.y,az:source.z,bx:target.x,by:target.y,bz:target.z,c1x:source.x+dx*.22,c1y:source.y+dy*.15,c2x:target.x-dx*.35,c2y:target.y,h0:strand.width[0],h1:strand.width[1]};
        }
      }
      const end=strand.end;
      const point=(t:number,out:Vector3)=>{
        if(curve)return cubic(curve,t,out);
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
        return out.set(source.x+(target.x-source.x)*t,source.y+(target.y-source.y)*t,-4);
      };
      const normal=(at:number,out:Vector3)=>{
        point(Math.max(0,at-.001),before);point(Math.min(1,at+.001),after);
        const dx=after.x-before.x,dy=after.y-before.y;
        return out.set(-dy,dx,0).divideScalar(Math.hypot(dx,dy)||1);
      };
      const half=(t:number)=>{
        if(strand.kind==='trunk')return trunkHalf(t);
        if(curve&&strand.kind==='branch')return limbHalf(curve,t);
        if(curve)return curve.h1+(curve.h0-curve.h1)*Math.pow(1-t,1.2);
        const [w0,w1]=strand.width;return w1+(w0-w1)*Math.pow(1-t,1.2);
      };
      for(let step=0;step<segments;step++){
        const t=step/segments,t1=(step+1)/segments;point(t,p);point(t1,q);
        normal(t,normalP);normal(t1,normalQ);
        const wp=half(t),wq=half(t1);
        geometries.forEach((g,glow)=>{
          const pos=g.getAttribute('position');
          if(!glow){
            // An elliptical tube gives the trunk and every limb volume from oblique viewpoints.
            const base=(index*segments+step)*6*sides;
            for(let face=0;face<sides;face++){
              const a=face*2*Math.PI/sides,b=(face+1)*2*Math.PI/sides;
              const write=(i:number,v:Vector3,n:Vector3,w:number,angle:number)=>{
                const ridge=1+.055*Math.sin(angle*4+v.y*.007)+.025*Math.sin(angle*8-v.y*.021);
                pos.setXYZ(base+face*6+i,v.x+n.x*w*ridge*Math.cos(angle),v.y+n.y*w*ridge*Math.cos(angle),v.z+w*.65*ridge*Math.sin(angle));
              };
              write(0,p,normalP,wp,a);write(1,p,normalP,wp,b);write(2,q,normalQ,wq,a);
              write(3,p,normalP,wp,b);write(4,q,normalQ,wq,b);write(5,q,normalQ,wq,a);
            }
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
    // Rotate each finished limb (including its leaves' twigs) out of its local plane.
    strands.forEach((s,index)=>{
      if(s.azimuth===undefined)return;
      const c=Math.cos(s.azimuth),sin=Math.sin(s.azimuth),pivot=s.pivotX??0;
      geometries.forEach((g,glow)=>{
        const pos=g.getAttribute('position'),count=segments*(glow?12:6*sides),start=index*count;
        for(let i=start;i<start+count;i++){
          const x=pos.getX(i)-pivot,z=pos.getZ(i);
          pos.setXYZ(i,pivot+x*c+z*sin,pos.getY(i),-x*sin+z*c);
        }
      });
    });
    geometries.forEach((g,i)=>{
      g.getAttribute('position').needsUpdate=true;
      if(i!==0)return;
      g.computeVertexNormals();
      const normals=g.getAttribute('normal');
      // Share shading around each tube ring without changing the unindexed
      // vertices used by the growth animation. This removes the polygon bands.
      for(let start=0;start<normals.count;start+=sides*6){
        const faces=Array.from({length:sides},(_,face)=>new Vector3().fromBufferAttribute(normals,start+face*6));
        const ring=faces.map((n,face)=>n.clone().add(faces[(face+sides-1)%sides]).normalize());
        for(let face=0;face<sides;face++)for(let v=0;v<6;v++){
          const n=ring[(face+([1,3,4].includes(v)?1:0))%sides];
          normals.setXYZ(start+face*6+v,n.x,n.y,n.z);
        }
      }
      normals.needsUpdate=true;
    });
  };
}

// Static scene objects: ground glow, ribbon meshes and dust points.
function barkTexture(){
  const width=128,height=512,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/width*Math.PI*2,v=y/height*Math.PI*2;
    const grain=Math.sin(u*19+.7*Math.sin(v*2)+.25*Math.sin(v*7));
    const fissure=Math.pow(Math.max(0,grain),12);
    const fine=Math.sin(u*47+.4*Math.sin(v*11))*.055;
    const shade=.73-fissure*.34+fine+.07*Math.sin(u*7+Math.sin(v*3));
    const c=Math.round(shade*255);data.set([c,c,c,255],(y*width+x)*4);
  }
  const texture=new DataTexture(data,width,height);texture.needsUpdate=true;return texture;
}

export function verticalTreeObjects(geometries:BufferGeometry[],dust:BufferGeometry):Object3D[]{
  // Stacked soft discs give the soil glow a gradual falloff without a hard rim.
  const ground=[1,.72,.48,.28].map((s,i)=>{
    const mesh=new Mesh(new SphereGeometry(90,40,16),new MeshBasicMaterial({color:i<2?'#3fa9e8':'#e8c96a',transparent:true,opacity:.022,depthWrite:false,blending:AdditiveBlending}));
    mesh.position.set(0,-110,-8-i);mesh.scale.set(VERTICAL_ROOT_REACH/90*.9*s,2.4*s,1);return mesh;
  });
  const texture=barkTexture();
  const ribbons=geometries.map((geometry,glow)=>{
    const mesh=new Mesh(geometry,glow?new MeshBasicMaterial({vertexColors:true,side:DoubleSide,transparent:true,depthWrite:false,blending:AdditiveBlending}):new MeshStandardMaterial({map:texture,bumpMap:texture,bumpScale:2.8,vertexColors:true,side:DoubleSide,transparent:true,alphaTest:.01,depthWrite:true,roughness:.96,metalness:0,blending:NormalBlending}));
    mesh.frustumCulled=false;mesh.renderOrder=glow?-3:-2;return mesh;
  });
  const points=new Points(dust,new PointsMaterial({vertexColors:true,size:5,map:dotTexture(),sizeAttenuation:false,transparent:true,opacity:.7,depthWrite:false,blending:AdditiveBlending}));
  points.frustumCulled=false;
  return [...ground,...ribbons,points];
}

// Leaf and knot styling for node spheres in the vertical view.
export function verticalTreeNodeStyle(node:TreePoint,dim:boolean,capScale=1){
  // Branch ends are small knots on the wood, not lamps.
  // Energy companies are root nodules: round, glowing, and sized by market cap.
  if(node.kind==='company'&&node.layer==='energy'){
    const radius=10+8*Math.min(2.5,Math.max(.65,capScale));
    return {radius,core:dim?.15:.95,glow:dim?.02:.14,glowRadius:radius*2};
  }
  const radius=node.kind==='company'?3.2*capScale:node.kind==='layer'?11:node.kind==='branch'?3.2:10;
  const knot=node.kind==='branch';
  return {radius,core:dim?.12:knot?.5:.95,glow:dim?.01:knot?.03:node.kind==='company'?.16:.12,glowRadius:radius*(node.kind==='company'?3.4:knot?1.8:2.8)};
}

// Company leaves. One shared blade and vein, drawn along +x from a base at the
// origin to a tip at x=1, so each leaf is just a rotation and scale. Vertex
// colours shade the blade (deeper at the stem, brighter across the middle) and
// multiply with each company's layer colour.
function leafBlade(){
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  const lengthSteps=18,widthSteps=6;
  for(let i=0;i<=lengthSteps;i++)for(let j=0;j<=widthSteps;j++){
    const x=i/lengthSteps,v=j/widthSteps*2-1;
    const width=.27*Math.sin(Math.PI*x)**.85*(1+.035*Math.sin(x*Math.PI*24));
    positions.push(x,v*width,.09*Math.sin(Math.PI*x)*(1-v*v)+.045*x*x+.015*v*Math.sin(x*Math.PI*2));
    const shade=.7+.25*Math.sin(Math.PI*x)-.12*Math.abs(v);
    colors.push(shade,shade,shade);
    if(i<lengthSteps&&j<widthSteps){const a=i*(widthSteps+1)+j,b=a+widthSteps+1;indices.push(a,b,a+1,a+1,b,b+1);}
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function leafVein(){
  const shape=new Shape();
  shape.moveTo(0,.006);shape.quadraticCurveTo(.5,.009,.9,0);shape.quadraticCurveTo(.5,-.009,0,-.006);shape.lineTo(0,.006);
  const veins=[shape];
  for(let i=1;i<=7;i++)for(const side of [-1,1]){
    const x=.08+i*.095,end=x+.13,y=side*.23*Math.sin(Math.PI*end)**.85;
    const vein=new Shape();vein.moveTo(x,-.002);vein.quadraticCurveTo(x+.075,y*.35,end,y);vein.quadraticCurveTo(x+.075,y*.35+.003,x,.002);vein.closePath();veins.push(vein);
  }
  const geometry=new ShapeGeometry(veins,18),p=geometry.getAttribute('position');
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),w=.27*Math.sin(Math.PI*x)**.85,v=w>0?p.getY(i)/w:0;
    p.setZ(i,.09*Math.sin(Math.PI*x)*(1-v*v)+.045*x*x+.015*v*Math.sin(x*Math.PI*2)+.002);
  }
  return geometry;
}
export const VERTICAL_LEAF_BLADE=leafBlade();
export const VERTICAL_LEAF_VEIN=leafVein();

// Each leaf leans away from its limb towards the limb's tip, tilted a little
// by a stable per-company jitter so a canopy looks grown rather than stamped.
// Size follows market cap within readable limits.
export function verticalLeafPose(node:TreePoint,parent:TreePoint|undefined,capScale=1,top=1){
  const [x,y]=node.planar??node.position,[px,py]=parent?.planar??parent?.position??[0,0];
  const jitter=verticalJitter(node.id,7)-.5;
  let angle=Math.atan2(y-py,x-px);
  if(parent?.kind==='branch'){
    const [ox,oy]=verticalBranchOrigin(parent,top);
    const lean=Math.atan2(py-oy,px-ox),flank=Math.sign((px-ox)*(y-oy)-(py-oy)*(x-ox))||1;
    angle=lean+flank*(.55+.35*verticalJitter(node.id,8));
  }
  angle+=jitter*.6;
  const length=108+58*Math.min(2.5,Math.max(.65,capScale));
  const tint=new Color('#6f9940').lerp(new Color(node.color),.12).offsetHSL(jitter*.06,jitter*.12,jitter*.12);
  return {angle,length,width:length*.78,tint:'#'+tint.getHexString()};
}
