"use client";

import {memo,useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {BackSide,Color,DoubleSide,Euler,Float32BufferAttribute,InstancedMesh,Object3D,PlaneGeometry,Quaternion,Shape,ShapeGeometry,Vector3,type MeshStandardMaterial,type Texture} from 'three';
import type {TreePoint} from '@/lib/ui/knowledge-graph/industry-tree';
import {verticalJitter as jitter,verticalTreeCrownCap,VERTICAL_SOIL_Y} from '@/lib/ui/knowledge-graph/vertical-tree';
import {leafClusterTexture,meadowTexture} from '@/lib/ui/knowledge-graph/leaf-texture';
import {createMeadowClock,meadowMaterial} from '@/lib/ui/knowledge-graph/tree-cinematic-material';
import {TreeCinematicAtmosphere} from './tree-cinematic-atmosphere';
import {TreeGalaxies} from './tree-galaxies';

const noHit=()=>{};
type Plant={position:[number,number,number];scale:[number,number,number];rotation:[number,number,number];color:string};
// The meadow is level with the soil, so the tree stands on flat ground and its
// roots and the Energy roots run underground. Only far from the trunk does the
// ground roll gently.
const MEADOW_Y=VERTICAL_SOIL_Y;
const groundHeight=(x:number,z:number)=>{
 const near=Math.exp(-(((x*x+z*z)/(1500*1500))**3));
 return MEADOW_Y+35*Math.sin(x/1100)*Math.cos(z/900)*(1-near);
};

// Decorative instances have no hit targets: company leaves and canvas gestures stay usable.
// With a map, each instance is a cut-out card anchored at its bottom edge.
function Plants({items,flower=false,leaf=false,map,material}:{items:Plant[];flower?:boolean;leaf?:boolean;map?:Texture|null;material:MeshStandardMaterial}){
 const ref=useRef<InstancedMesh>(null);
 const geometry=useMemo(()=>{
  if(map)return new PlaneGeometry(1,1).translate(0,.5,0);
  const shape=new Shape();
  if(flower){for(let i=0;i<=20;i++){const a=i/20*Math.PI*2,r=.58+.28*Math.cos(a*5);if(i===0)shape.moveTo(Math.cos(a)*r,Math.sin(a)*r);else shape.lineTo(Math.cos(a)*r,Math.sin(a)*r);}}
  else if(leaf){shape.moveTo(0,0);shape.lineTo(-.42,.65);shape.lineTo(0,1.7);shape.lineTo(.4,.65);shape.closePath();}
  else {shape.moveTo(-.14,0);shape.lineTo(.12,0);shape.lineTo(.08,1.8);shape.closePath();}
  return new ShapeGeometry(shape,3);
 },[flower,leaf,map]);
 useEffect(()=>()=>geometry.dispose(),[geometry]);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;
  const dummy=new Object3D();
  items.forEach((plant,i)=>{dummy.position.set(...plant.position);dummy.scale.set(...plant.scale);dummy.rotation.set(...plant.rotation);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new Color(plant.color));});
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
 },[items]);
 return <instancedMesh key={items.length} ref={ref} args={[geometry,material,items.length]} raycast={noHit} dispose={null}/>;
}

// Keep each limb's instance buffer alive as other branches enter or leave.
// Leafy twigs pack into a rounded clump around the limb tip, denser towards its
// surface and pointing outwards; the sunward side is brighter and the underside
// falls into shade, so the crown reads as soft volumes of individual leaves.
const SUN=new Vector3(.45,.8,.4).normalize(),UP=new Vector3(0,1,0);
const LEAF_SHADE=new Color('#2b5520'),LEAF_MID=new Color('#6e9e3c'),LEAF_LIT=new Color('#e2f59a');
// Lower clumps spread into a broad skirt; upper clumps retain enough volume
// for a rounded crown rather than a narrow, pointed tip.
const Canopy=memo(function Canopy({node,crown,map,material,crownCap=false}:{node:TreePoint;crown:[number,number];map:Texture|null;material:MeshStandardMaterial;crownCap?:boolean}){
 const items=useMemo(()=>{
  const [nx,y,nz]=node.position,direction=new Vector3(),facing=new Vector3(),color=new Color(),turn=new Quaternion(),twist=new Quaternion(),euler=new Euler();
  const height=Math.min(1,Math.max(0,(y-crown[0])/(crown[1]-crown[0]||1))),lower=(1-height)**2;
  const upper=Math.max(0,(height-.65)/.35);
  const swell=.72+.48*Math.sin(Math.PI*(.12+.88*height))+.3*lower+.46*upper*upper;
  const out=Math.hypot(nx,nz)||1,spread=(swell-1)*260+110*lower,x=nx+nx/out*spread,z=nz+nz/out*spread;
  return Array.from({length:map?(crownCap?620:260+Math.round(120*lower+180*upper)):850},(_,i):Plant=>{
   const id=`${node.id}:canopy:${i}`,lift=jitter(id,1)*2-1,a=jitter(id,2)*Math.PI*2,ring=Math.sqrt(1-lift*lift);
   direction.set(Math.cos(a)*ring,lift,Math.sin(a)*ring);
   const depth=.4+.6*Math.sqrt(jitter(id,3)),light=Math.max(0,direction.dot(SUN))*depth;
   color.copy(LEAF_SHADE).lerp(LEAF_MID,Math.min(1,.25+depth*.75+direction.y*.2)).lerp(LEAF_LIT,light*.8).offsetHSL((jitter(id,8)-.5)*.04,0,(jitter(id,9)-.5)*.08);
   const position:[number,number,number]=[x+direction.x*depth*400*swell,y+90+direction.y*depth*300*swell,z+direction.z*depth*360*swell];
   if(!map){const s=26+jitter(id,4)*30;return {position,scale:[s,s,s],rotation:[jitter(id,5)*Math.PI,jitter(id,6)*Math.PI*2,jitter(id,7)*Math.PI],color:'#'+color.getHexString()};}
   // Twigs grow outwards and a little upwards, each turned about its own stem.
   facing.copy(direction).multiplyScalar(.75).addScaledVector(UP,.45).add(new Vector3(jitter(id,5)-.5,jitter(id,6)-.5,jitter(id,7)-.5).multiplyScalar(.5)).normalize();
   turn.setFromUnitVectors(UP,facing).multiply(twist.setFromAxisAngle(UP,jitter(id,10)*Math.PI*2));
   euler.setFromQuaternion(turn);
   const s=(crownCap?96:78)+jitter(id,4)*44;
   return {position,scale:[s,s,s],rotation:[euler.x,euler.y,euler.z],color:'#'+color.getHexString()};
  });
 },[node,crown,map,crownCap]);
 return <Plants items={items} leaf map={map} material={material}/>;
},(a,b)=>a.node.id===b.node.id&&a.map===b.map&&a.material===b.material&&a.crownCap===b.crownCap&&a.crown[0]===b.crown[0]&&a.crown[1]===b.crown[1]&&a.node.position.every((value,i)=>value===b.node.position[i]));

// A cumulus is a cluster of squashed puffs: tall in the middle, trailing off
// at the ends, with a flat base. At dusk they glow faintly violet from within.
function Clouds(){
 const ref=useRef<InstancedMesh>(null);
 const puffs=useMemo(()=>Array.from({length:11},(_,i)=>{
  const id=`cloud${i}`,a=(i+jitter(id,2)*.6)/11*Math.PI*2,r=16000+jitter(id,3)*7000,s=.8+jitter(id,4)*.6,angle=-a+Math.PI/2,count=7+Math.floor(jitter(id,1)*5);
  return Array.from({length:count},(_,j)=>{
   const along=j/(count-1)*2-1,peak=1-along*along,size=(.55+.55*peak)*(.8+.4*jitter(id,j+10));
   const x=(along*1500+(jitter(id,j+20)-.5)*300)*s,z=(jitter(id,j+40)-.5)*600*s;
   return {x:Math.cos(a)*r+x*Math.cos(angle)+z*Math.sin(angle),y:5200+jitter(id)*2600+(size*220+(jitter(id,j+30)-.3)*160*peak)*s,z:Math.sin(a)*r-x*Math.sin(angle)+z*Math.cos(angle),s:size*s,angle};
  });
 }).flat(),[]);
 useLayoutEffect(()=>{
  const mesh=ref.current;if(!mesh)return;const dummy=new Object3D();
  puffs.forEach((puff,index)=>{dummy.position.set(puff.x,puff.y,puff.z);dummy.rotation.set(0,puff.angle,0);dummy.scale.set(puff.s*820,puff.s*480,puff.s*620);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);});
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
 },[puffs]);
 return <instancedMesh ref={ref} args={[undefined,undefined,puffs.length]} raycast={noHit}><sphereGeometry args={[1,12,8]}/><meshStandardMaterial color="#8c7bb0" emissive="#5d4b8c" emissiveIntensity={.55} roughness={1}/></instancedMesh>;
}
const SKY_SHADER=`varying vec3 direction;
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
void main(){
 vec3 d=normalize(direction);float h=max(0.,d.y);
 vec3 sky=mix(vec3(.26,.22,.4),vec3(.11,.1,.3),smoothstep(0.,.12,h));
 sky=mix(sky,vec3(.02,.035,.13),smoothstep(.08,.55,h));
 float band=exp(-pow(dot(d,normalize(vec3(.57,-.62,-.44)))/.2,2.))*smoothstep(.04,.3,h);
 // Noise is the costliest part of the sky; evaluate it only inside the Milky Way band.
 if(band>.01)sky+=band*(vec3(.3,.24,.58)*fbm(d*3.5)+vec3(.28,.36,.66)*smoothstep(.45,.8,fbm(d*9.+3.)));
 vec3 heading=normalize(vec3(d.x,0.,d.z)+1e-4);
 float behind=pow(max(0.,dot(heading,normalize(vec3(-.35,0.,-1.)))),4.);
 sky+=vec3(1.,.7,.34)*exp(-h*5.)*(.08+.8*behind)+vec3(1.,.86,.6)*exp(-h*14.)*behind*.5;
 gl_FragColor=vec4(sky,1.);
}`;
const MOUNTAIN_TONES=[['#2c2f5a','#5a5488'],['#232a4c','#47487a'],['#1b2b33','#34465a']];

export function TreeMeadowEnvironment({nodes,layoutNodes=nodes,paused=false}:{nodes:TreePoint[];layoutNodes?:TreePoint[];paused?:boolean}){
 const limbs=nodes.filter(node=>node.kind==='branch'&&node.layer!=='energy');
 const allLimbs=layoutNodes.filter(node=>node.kind==='branch'&&node.layer!=='energy');
 const low=Math.min(...allLimbs.map(node=>node.position[1])),high=Math.max(...allLimbs.map(node=>node.position[1]));
 const crown=useMemo(():[number,number]=>[low,high],[low,high]);
 // A leafy cap joins the upper limb clusters across the exposed trunk tip.
 // It closes with its owning sector, just like that sector's limb clusters.
 const crownCap=useMemo(()=>verticalTreeCrownCap(nodes),[nodes]);
 const leaves=useMemo(()=>leafClusterTexture(),[]);
 const clock=useMemo(()=>createMeadowClock(),[]);
 const foliage=useMemo(()=>meadowMaterial(clock,leaves,true),[clock,leaves]);
 const grassMaterial=useMemo(()=>meadowMaterial(clock,null),[clock]);
 useEffect(()=>()=>{foliage.dispose();grassMaterial.dispose();},[foliage,grassMaterial]);
 // One grass tile every ~280 units: blades and soil flecks read up close, blend into the meadow's tint far away.
 const turf=useMemo(()=>{const texture=meadowTexture();texture?.repeat.set(72,72);return texture;},[]);
 useEffect(()=>()=>{leaves?.dispose();turf?.dispose();},[leaves,turf]);
 const terrain=useMemo(()=>{
  const geometry=new PlaneGeometry(20000,20000,96,96);geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position;
  const colors=[];
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),z=positions.getZ(i);positions.setY(i,groundHeight(x,z));
   const color=new Color('#1d4519').lerp(new Color('#4f7a2a'),.4+.22*Math.sin(x/360)*Math.cos(z/550)+jitter(`ground${i}`)*.18);colors.push(...color.toArray());
  }
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();return geometry;
 },[]);
 const grass=useMemo(()=>Array.from({length:6000},(_,i):Plant=>{
  const id=`grass-${i}`,a=jitter(id,1)*Math.PI*2,r=320+Math.sqrt(jitter(id,2))*6800,x=Math.cos(a)*r,z=Math.sin(a)*r,h=18+jitter(id,3)*42;
  return {position:[x,groundHeight(x,z),z],scale:[h*.27,h,h],rotation:[-.18+jitter(id,4)*.35,a,0],color:['#528b28','#81ac32','#96b943','#3f7626'][i%4]};
 }),[]);
 const flowers=useMemo(()=>Array.from({length:400},(_,i):Plant=>{
  const id=`flower-${i}`,a=jitter(id,1)*Math.PI*2,r=1200+Math.sqrt(jitter(id,2))*5000,x=Math.cos(a)*r,z=Math.sin(a)*r,s=7+jitter(id,3)*10;
  return {position:[x,groundHeight(x,z)+22,z],scale:[s,s,s],rotation:[-Math.PI/2+.3,a,0],color:['#ffe36a','#fff6df','#efb7cc','#f9d13d'][i%4]};
 }),[]);
 // Three ranges recede into haze: the farthest is tallest, bluest and snow-capped.
 // Ridges fold several octaves (with sharpened crests) so the skyline is not a smooth wave.
 // Each range is drawn four times around the meadow, so keep its mesh modest:
 // a much denser one made software-rendered and low-end GPUs visibly slower.
 const mountains=useMemo(()=>Array.from({length:3},(_,layer)=>{
  const geometry=new PlaneGeometry(120000,12000,240,4);const positions=geometry.attributes.position;
  const [base,peak]=MOUNTAIN_TONES[layer].map(hex=>new Color(hex)),snow=new Color('#b6b4dc'),colors=[];
  const near=layer/2,color=new Color();
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),v=(positions.getY(i)+6000)/12000;
   const crest=(f:number,o:number)=>1-Math.abs(Math.sin(x/f+o));
   const ridge=(2900-near*1300)+(1300-near*500)*Math.sin(x/2900+layer*3)+(900-near*350)*crest(2100,layer*1.7)+380*crest(820,layer)+120*Math.sin(x/230+layer);
   const height=v*ridge;
   positions.setY(i,MEADOW_Y-220+height);positions.setZ(i,Math.sin(x/1800)*600);
   color.copy(base).lerp(peak,Math.pow(v,1.6)*.9);
   if(layer===0)color.lerp(snow,Math.min(1,Math.max(0,(height-2600)/500))*Math.min(1,Math.max(0,(v-.72)/.12)));
   colors.push(...color.toArray());
  }
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();return geometry;
 }),[]);
 useEffect(()=>()=>{terrain.dispose();mountains.forEach(geometry=>geometry.dispose());},[terrain,mountains]);
 return <>
  <color attach="background" args={['#0b1030']}/>
  <fog attach="fog" args={['#2f2c55',7500,33000]}/>
  <group name="meadow-environment">
  {/* Night sky: deep indigo overhead over a violet band of Milky Way dust, with a warm afterglow along the horizon behind the tree. */}
  <mesh raycast={noHit}><sphereGeometry args={[65000,32,20]}/><shaderMaterial side={BackSide} depthWrite={false} toneMapped={false}
   vertexShader="varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}"
   fragmentShader={SKY_SHADER}/></mesh>
  <mesh rotation={[-Math.PI/2,0,0]} position={[0,MEADOW_Y-60,0]} raycast={noHit}><planeGeometry args={[140000,140000]}/><meshStandardMaterial color="#26421f" roughness={1}/></mesh>
  <mesh geometry={terrain} raycast={noHit}><meshStandardMaterial vertexColors map={turf} roughness={1}/></mesh>
  {[0,Math.PI/2,Math.PI,Math.PI*1.5].map(angle=><group key={angle} rotation={[0,angle,0]}>{mountains.map((geometry,i)=><mesh key={i} position={[0,0,-23000+i*4500]} geometry={geometry} raycast={noHit}><meshStandardMaterial vertexColors roughness={1} side={DoubleSide}/></mesh>)}</group>)}
  <Clouds/>
  <TreeGalaxies height={Number.isFinite(high)?high:2400}/>
  <Plants items={grass} material={grassMaterial}/><Plants items={flowers} flower material={grassMaterial}/>{limbs.map(node=><Canopy key={node.id} node={node} crown={crown} map={leaves} material={foliage}/>)}
  {crownCap&&<Canopy node={crownCap} crown={crown} map={leaves} material={foliage} crownCap/>}
  <TreeCinematicAtmosphere clock={clock} paused={paused} top={Number.isFinite(high)?high:2400}/>
 </group></>;
}
