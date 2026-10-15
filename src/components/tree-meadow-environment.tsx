"use client";

import {memo,useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {BackSide,Color,DoubleSide,Float32BufferAttribute,InstancedMesh,Object3D,PlaneGeometry,Shape,ShapeGeometry} from 'three';
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
  <meshStandardMaterial side={DoubleSide} roughness={.85} metalness={0} emissive={leaf?'#42771a':'#182c04'} emissiveIntensity={leaf?.24:.07}/>
 </instancedMesh>;
}

// Keep each limb's instance buffer alive as other branches enter or leave.
const Canopy=memo(function Canopy({node}:{node:TreePoint}){
 const items=useMemo(()=>Array.from({length:650},(_,i):Plant=>{
  const id=`${node.id}:canopy:${i}`,a=jitter(id,1)*Math.PI*2,r=Math.sqrt(jitter(id,2)),span=420;
  const [x,y,z]=node.position,s=28+jitter(id,4)*28;
  return {position:[x+Math.cos(a)*r*span,y+(jitter(id,3)-.15)*span*.9,z+Math.sin(a)*r*span*.8],scale:[s,s,s],rotation:[jitter(id,5)*Math.PI,jitter(id,6)*Math.PI*2,jitter(id,7)*Math.PI],color:['#2e6b22','#65952d','#91ba41','#487e23','#aac75c'][i%5]};
 }),[node]);
 return <Plants items={items} leaf/>;
},(a,b)=>a.node.id===b.node.id&&a.node.position.every((value,i)=>value===b.node.position[i]));

export function TreeMeadowEnvironment({nodes}:{nodes:TreePoint[]}){
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
 const mountains=useMemo(()=>Array.from({length:3},(_,layer)=>{
  const geometry=new PlaneGeometry(120000,12000,160,2);const positions=geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),v=(positions.getY(i)+6000)/12000;
   const ridge=1700+layer*600+1100*Math.sin(x/2900+layer*3)+600*Math.sin(x/1300+layer)+300*Math.sin(x/570);
   positions.setY(i,-1200+v*ridge);positions.setZ(i,Math.sin(x/1800)*600);
  }
  geometry.computeVertexNormals();return geometry;
 }),[]);
 useEffect(()=>()=>{terrain.dispose();mountains.forEach(geometry=>geometry.dispose());},[terrain,mountains]);
 return <>
  <color attach="background" args={['#92d2ed']}/>
  <fog attach="fog" args={['#c1dfdf',9500,38000]}/>
  <group name="meadow-environment">
  <mesh raycast={noHit}><sphereGeometry args={[65000,24,16]}/><shaderMaterial side={BackSide} depthWrite={false} toneMapped={false}
   vertexShader="varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}"
   fragmentShader="varying vec3 direction;void main(){vec3 d=normalize(direction);float h=pow(max(0.,d.y),.45);vec3 sky=mix(vec3(.76,.89,.96),vec3(.17,.55,.84),h);float sun=pow(max(0.,dot(d,normalize(vec3(.5,.7,-.6)))),180.);gl_FragColor=vec4(mix(sky,vec3(1.,.97,.83),sun*.7),1.);}"/></mesh>
  <mesh rotation={[-Math.PI/2,0,0]} position={[0,-1100,0]} raycast={noHit}><planeGeometry args={[140000,140000]}/><meshStandardMaterial color="#769d53" roughness={1}/></mesh>
  <mesh geometry={terrain} raycast={noHit}><meshStandardMaterial vertexColors roughness={1}/></mesh>
  {[0,Math.PI/2,Math.PI,Math.PI*1.5].map(angle=><group key={angle} rotation={[0,angle,0]}>{mountains.map((geometry,i)=><mesh key={i} position={[0,0,-23000+i*4500]} geometry={geometry} raycast={noHit}><meshStandardMaterial color={['#9ebdc0','#82a8ab','#719795'][i]} roughness={1} side={DoubleSide}/></mesh>)}</group>)}
  {Array.from({length:9},(_,i)=>{const a=i/9*Math.PI*2;return <group key={i} position={[Math.cos(a)*18000,6500+jitter(`cloud${i}`)*1600,Math.sin(a)*18000]} rotation={[0,-a,0]}>{Array.from({length:5},(_,j)=><mesh key={j} position={[(j-2)*550,Math.sin(j*2)*150,0]} scale={[800,260+j%2*120,450]} raycast={noHit}><sphereGeometry args={[1,8,6]}/><meshBasicMaterial color={j%2?'#f5fbfb':'#ffffff'} transparent opacity={.78} depthWrite={false}/></mesh>)}</group>;})}
  <Plants items={grass}/><Plants items={flowers} flower/>{nodes.filter(node=>node.kind==='branch'&&node.layer!=='energy').map(node=><Canopy key={node.id} node={node}/>)}
 </group></>;
}
