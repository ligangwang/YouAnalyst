"use client";

import {memo,useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {BackSide,Color,DoubleSide,Float32BufferAttribute,InstancedMesh,Object3D,PlaneGeometry,Shape,ShapeGeometry,Vector3} from 'three';
import type {TreePoint} from '@/lib/ui/knowledge-graph/industry-tree';
import {verticalJitter as jitter} from '@/lib/ui/knowledge-graph/vertical-tree';

const noHit=()=>{};
type Plant={position:[number,number,number];scale:[number,number,number];rotation:[number,number,number];color:string};
const groundHeight=(x:number,z:number)=>-980+900*Math.exp(-(x*x+z*z)/700000)+35*Math.sin(x/1100)*Math.cos(z/900);

// Decorative instances have no hit targets: company leaves and canvas gestures stay usable.
function Plants({items,flower=false,leaf=false}:{items:Plant[];flower?:boolean;leaf?:boolean}){
 const ref=useRef<InstancedMesh>(null);
 const geometry=useMemo(()=>{
  const shape=new Shape();
  if(flower){for(let i=0;i<=20;i++){const a=i/20*Math.PI*2,r=.58+.28*Math.cos(a*5);if(i===0)shape.moveTo(Math.cos(a)*r,Math.sin(a)*r);else shape.lineTo(Math.cos(a)*r,Math.sin(a)*r);}}
  else if(leaf){shape.moveTo(0,0);shape.lineTo(-.42,.65);shape.lineTo(0,1.7);shape.lineTo(.4,.65);shape.closePath();}
  else {shape.moveTo(-.14,0);shape.lineTo(.12,0);shape.lineTo(.08,1.8);shape.closePath();}
  return new ShapeGeometry(shape,3);
 },[flower,leaf]);
 useEffect(()=>()=>geometry.dispose(),[geometry]);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;
  const dummy=new Object3D();
  items.forEach((plant,i)=>{dummy.position.set(...plant.position);dummy.scale.set(...plant.scale);dummy.rotation.set(...plant.rotation);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new Color(plant.color));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items]);
 return <instancedMesh key={items.length} ref={ref} args={[geometry,undefined,items.length]} raycast={noHit}>
  <meshStandardMaterial side={DoubleSide} roughness={.85} metalness={0} emissive={leaf?'#2f5c14':'#182c04'} emissiveIntensity={leaf?.16:.07}/>
 </instancedMesh>;
}

// Keep each limb's instance buffer alive as other branches enter or leave.
// Leaves pack into a rounded clump around the limb tip, denser towards its
// surface; the sunward side is brighter and the underside falls into shade,
// so the crown reads as soft volumes instead of one flat block of green.
const SUN=new Vector3(.45,.8,.4).normalize();
const LEAF_SHADE=new Color('#1d4a1b'),LEAF_MID=new Color('#4a8a2a'),LEAF_LIT=new Color('#b9d867');
// Clumps swell through the middle of the crown and shrink towards its base and
// top, so the canopy rounds out instead of stacking into a column.
const Canopy=memo(function Canopy({node,crown}:{node:TreePoint;crown:[number,number]}){
 const items=useMemo(()=>{
  const [nx,y,nz]=node.position,direction=new Vector3(),color=new Color();
  const height=Math.min(1,Math.max(0,(y-crown[0])/(crown[1]-crown[0]||1))),swell=.72+.48*Math.sin(Math.PI*(.12+.88*height));
  const out=Math.hypot(nx,nz)||1,x=nx+nx/out*(swell-1)*260,z=nz+nz/out*(swell-1)*260;
  return Array.from({length:650},(_,i):Plant=>{
   const id=`${node.id}:canopy:${i}`,lift=jitter(id,1)*2-1,a=jitter(id,2)*Math.PI*2,ring=Math.sqrt(1-lift*lift);
   direction.set(Math.cos(a)*ring,lift,Math.sin(a)*ring);
   const depth=.4+.6*Math.sqrt(jitter(id,3)),light=Math.max(0,direction.dot(SUN))*depth,s=26+jitter(id,4)*30;
   color.copy(LEAF_SHADE).lerp(LEAF_MID,Math.min(1,.25+depth*.75+direction.y*.2)).lerp(LEAF_LIT,light*.8).offsetHSL((jitter(id,8)-.5)*.04,0,(jitter(id,9)-.5)*.08);
   return {position:[x+direction.x*depth*400*swell,y+90+direction.y*depth*300*swell,z+direction.z*depth*360*swell],scale:[s,s,s],rotation:[jitter(id,5)*Math.PI,jitter(id,6)*Math.PI*2,jitter(id,7)*Math.PI],color:'#'+color.getHexString()};
  });
 },[node,crown]);
 return <Plants items={items} leaf/>;
},(a,b)=>a.node.id===b.node.id&&a.crown[0]===b.crown[0]&&a.crown[1]===b.crown[1]&&a.node.position.every((value,i)=>value===b.node.position[i]));

// A cumulus is a cluster of squashed puffs: tall in the middle, trailing off
// at the ends, with a flat base. Lit from above, so the underside greys softly.
function Cloud({seed}:{seed:number}){
 const puffs=useMemo(()=>{
  const id=`cloud${seed}`,count=7+Math.floor(jitter(id,1)*5);
  return Array.from({length:count},(_,j)=>{
   const along=(j/(count-1))*2-1,peak=1-along*along,size=(.55+.55*peak)*(.8+.4*jitter(id,j+10));
   return {position:[along*1500+(jitter(id,j+20)-.5)*300,size*220+(jitter(id,j+30)-.3)*160*peak,(jitter(id,j+40)-.5)*600] as [number,number,number],scale:[size*820,size*480,size*620] as [number,number,number]};
  });
 },[seed]);
 return <>{puffs.map((puff,j)=><mesh key={j} position={puff.position} scale={puff.scale} raycast={noHit}><sphereGeometry args={[1,20,14]}/><meshStandardMaterial color="#ffffff" emissive="#d9e6f2" emissiveIntensity={.62} roughness={1} transparent opacity={.94} depthWrite={false}/></mesh>)}</>;
}
const MOUNTAIN_TONES=[['#7f9db6','#c3d4e3'],['#6b8f9c','#a3bfc6'],['#58806a','#8eae96']];

export function TreeMeadowEnvironment({nodes}:{nodes:TreePoint[]}){
 const limbs=nodes.filter(node=>node.kind==='branch'&&node.layer!=='energy');
 const low=Math.min(...limbs.map(node=>node.position[1])),high=Math.max(...limbs.map(node=>node.position[1]));
 const crown=useMemo(():[number,number]=>[low,high],[low,high]);
 const terrain=useMemo(()=>{
  const geometry=new PlaneGeometry(20000,20000,96,96);geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position;
  const colors=[];
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),z=positions.getZ(i);positions.setY(i,groundHeight(x,z));
   const color=new Color('#588335').lerp(new Color('#a8b85e'),.4+.22*Math.sin(x/360)*Math.cos(z/550)+jitter(`ground${i}`)*.18);colors.push(...color.toArray());
  }
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();return geometry;
 },[]);
 const grass=useMemo(()=>Array.from({length:6000},(_,i):Plant=>{
  const id=`grass-${i}`,a=jitter(id,1)*Math.PI*2,r=650+Math.sqrt(jitter(id,2))*6500,x=Math.cos(a)*r,z=Math.sin(a)*r,h=18+jitter(id,3)*42;
  return {position:[x,groundHeight(x,z),z],scale:[h*.27,h,h],rotation:[-.18+jitter(id,4)*.35,a,0],color:['#528b28','#81ac32','#96b943','#3f7626'][i%4]};
 }),[]);
 const flowers=useMemo(()=>Array.from({length:400},(_,i):Plant=>{
  const id=`flower-${i}`,a=jitter(id,1)*Math.PI*2,r=1200+Math.sqrt(jitter(id,2))*5000,x=Math.cos(a)*r,z=Math.sin(a)*r,s=7+jitter(id,3)*10;
  return {position:[x,groundHeight(x,z)+22,z],scale:[s,s,s],rotation:[-Math.PI/2+.3,a,0],color:['#ffe36a','#fff6df','#efb7cc','#f9d13d'][i%4]};
 }),[]);
 // Three ranges recede into haze: the farthest is tallest, bluest and snow-capped.
 // Ridges fold several octaves (with sharpened crests) so the skyline is not a smooth wave.
 const mountains=useMemo(()=>Array.from({length:3},(_,layer)=>{
  const geometry=new PlaneGeometry(120000,12000,640,24);const positions=geometry.attributes.position;
  const [base,peak]=MOUNTAIN_TONES[layer].map(hex=>new Color(hex)),snow=new Color('#f4f8fb'),colors=[];
  const near=layer/2,color=new Color();
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),v=(positions.getY(i)+6000)/12000;
   const crest=(f:number,o:number)=>1-Math.abs(Math.sin(x/f+o));
   const ridge=(2900-near*1300)+(1300-near*500)*Math.sin(x/2900+layer*3)+(900-near*350)*crest(2100,layer*1.7)+380*crest(820,layer)+120*Math.sin(x/230+layer);
   const height=v*ridge;
   positions.setY(i,-1200+height);positions.setZ(i,Math.sin(x/1800)*600);
   color.copy(base).lerp(peak,Math.pow(v,1.6)*.9);
   if(layer===0)color.lerp(snow,Math.min(1,Math.max(0,(height-2600)/500))*Math.min(1,Math.max(0,(v-.72)/.12)));
   colors.push(...color.toArray());
  }
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();return geometry;
 }),[]);
 useEffect(()=>()=>{terrain.dispose();mountains.forEach(geometry=>geometry.dispose());},[terrain,mountains]);
 return <>
  <color attach="background" args={['#a9d6ee']}/>
  <fog attach="fog" args={['#cfe4ea',9500,38000]}/>
  <group name="meadow-environment">
  {/* Sky: pale, warm haze at the horizon deepening to blue overhead, with a soft halo around the sun. */}
  <mesh raycast={noHit}><sphereGeometry args={[65000,32,20]}/><shaderMaterial side={BackSide} depthWrite={false} toneMapped={false}
   vertexShader="varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}"
   fragmentShader="varying vec3 direction;void main(){vec3 d=normalize(direction);float h=max(0.,d.y);vec3 horizon=vec3(.9,.94,.93);vec3 sky=mix(horizon,vec3(.58,.8,.94),smoothstep(0.,.16,h));sky=mix(sky,vec3(.2,.5,.84),smoothstep(.12,.9,h));float sun=max(0.,dot(d,normalize(vec3(.5,.7,-.6))));sky+=vec3(1.,.86,.62)*pow(sun,6.)*.2+vec3(1.,.96,.84)*pow(sun,260.)*.8;gl_FragColor=vec4(sky,1.);}"/></mesh>
  <mesh rotation={[-Math.PI/2,0,0]} position={[0,-1100,0]} raycast={noHit}><planeGeometry args={[140000,140000]}/><meshStandardMaterial color="#769d53" roughness={1}/></mesh>
  <mesh geometry={terrain} raycast={noHit}><meshStandardMaterial vertexColors roughness={1}/></mesh>
  {[0,Math.PI/2,Math.PI,Math.PI*1.5].map(angle=><group key={angle} rotation={[0,angle,0]}>{mountains.map((geometry,i)=><mesh key={i} position={[0,0,-23000+i*4500]} geometry={geometry} raycast={noHit}><meshStandardMaterial vertexColors roughness={1} side={DoubleSide}/></mesh>)}</group>)}
  {Array.from({length:11},(_,i)=>{const a=(i+jitter(`cloud${i}`,2)*.6)/11*Math.PI*2,r=16000+jitter(`cloud${i}`,3)*7000,s=.8+jitter(`cloud${i}`,4)*.6;return <group key={i} position={[Math.cos(a)*r,5200+jitter(`cloud${i}`)*2600,Math.sin(a)*r]} rotation={[0,-a+Math.PI/2,0]} scale={s}><Cloud seed={i}/></group>;})}
  <Plants items={grass}/><Plants items={flowers} flower/>{limbs.map(node=><Canopy key={node.id} node={node} crown={crown}/>)}
 </group></>;
}
