"use client";

import {useEffect,useMemo,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {AdditiveBlending,BufferGeometry,DoubleSide,Float32BufferAttribute,Vector3} from 'three';
import {verticalJitter as jitter,VERTICAL_SOIL_Y} from '@/lib/ui/knowledge-graph/vertical-tree';
import type {MeadowClock} from '@/lib/ui/knowledge-graph/tree-cinematic-material';

const noHit=()=>{};
const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/** Soft object-space shafts and a single pollen draw call, without a full-screen post pass. */
export function TreeCinematicAtmosphere({clock,paused,top}:{clock:MeadowClock;paused:boolean;top:number}){
 const {gl,invalidate,size}=useThree();
 const motion=useRef(false);
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  let timer:number|undefined;
  const update=()=>{
   window.clearInterval(timer);timer=undefined;
   motion.current=!paused&&!media.matches&&!document.hidden;
   clock.setWind(media.matches?0:1);
   gl.domElement.setAttribute('data-tree-effects','cinematic');
   gl.domElement.setAttribute('data-tree-motion',paused||document.hidden?'paused':media.matches?'reduced':'animated');
   if(motion.current)timer=window.setInterval(invalidate,50);
   invalidate();
  };
  update();media.addEventListener('change',update);document.addEventListener('visibilitychange',update);
  // Demand mode stays asleep off-screen and for reduced motion. Idle ambience
  // requests at most 20 fps; camera gestures/tours can render independently.
  return()=>{window.clearInterval(timer);media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);};
 },[clock,gl,invalidate,paused]);
 useFrame((_,delta)=>{
  if(motion.current)clock.advance(delta);
  gl.domElement.setAttribute('data-tree-effect-time',clock.time.value.toFixed(2));
 });
 const height=Math.max(2200,top+600);
 const shafts=useMemo(()=>{
  const positions:number[]=[],uv:number[]=[];
  const sun=new Vector3(2100,height+2100,-2200);
  for(let i=0;i<7;i++){
   const end=new Vector3(-1900+i*530,VERTICAL_SOIL_Y+15,300+(i%3)*440);
   const direction=end.clone().sub(sun),across=new Vector3().crossVectors(direction,new Vector3(0,0,1)).normalize();
   const start=sun.clone().lerp(end,.12+jitter('shaft'+i)*.18);
   const points=[start.clone().addScaledVector(across,-18),start.clone().addScaledVector(across,18),end.clone().addScaledVector(across,95+i*13),end.clone().addScaledVector(across,-95-i*13)];
   for(const index of [0,1,2,0,2,3]){positions.push(...points[index].toArray());uv.push(...[[0,1],[1,1],[1,0],[0,0]][index]);}
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeBoundingSphere();return geometry;
 },[height]);
 const pollen=useMemo(()=>{
  const points:number[]=[],seeds:number[]=[];
  for(let i=0;i<160;i++){const id='pollen'+i,a=jitter(id)*Math.PI*2,r=450+Math.sqrt(jitter(id,1))*2200;points.push(Math.cos(a)*r,jitter(id,2)*height,Math.sin(a)*r);seeds.push(jitter(id,3));}
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setAttribute('seed',new Float32BufferAttribute(seeds,1));geometry.setDrawRange(0,size.width<640?64:160);return geometry;
 },[height,size.width]);
 useEffect(()=>()=>shafts.dispose(),[shafts]);
 useEffect(()=>()=>pollen.dispose(),[pollen]);
 const uniforms=useMemo(()=>({time:clock.time,wind:clock.wind,height:{value:height}}),[clock,height]);
 return <group name="cinematic-atmosphere">
  <mesh geometry={shafts} raycast={noHit} renderOrder={2}>
   <shaderMaterial uniforms={uniforms} vertexShader={vertex} fragmentShader={`varying vec2 vUv;uniform float time;uniform float wind;void main(){float edge=pow(sin(vUv.x*3.14159265),1.8);float fade=smoothstep(0.,.18,vUv.y)*(1.-smoothstep(.65,1.,vUv.y));float veil=.88+.12*sin(vUv.y*19.+time*.18*wind);gl_FragColor=vec4(1.,.83,.48,edge*fade*veil*.075);}`} transparent depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false}/>
  </mesh>
  <points geometry={pollen} raycast={noHit}>
   <shaderMaterial uniforms={uniforms} vertexShader={`attribute float seed;uniform float time;uniform float height;uniform float wind;varying float alpha;void main(){vec3 p=position;p.y=mod(p.y+time*7.*wind,height);p.x+=sin(time*.16*wind+seed*36.)*65.;p.z+=cos(time*.12*wind+seed*28.)*45.;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((16.+seed*14.)*550./max(1.,-mv.z),1.,4.);alpha=.15+seed*.4;}`} fragmentShader={`varying float alpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(1.,.9,.62,(1.-smoothstep(.1,1.,d))*alpha);}`} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false}/>
  </points>
  {/* Ground contact remains soft and local instead of requiring a shadow-map pass. */}
  <mesh position={[0,VERTICAL_SOIL_Y+2,0]} rotation={[-Math.PI/2,0,0]} raycast={noHit}>
   <planeGeometry args={[3000,2400]}/><shaderMaterial vertexShader={vertex} fragmentShader={`varying vec2 vUv;void main(){float d=length((vUv-.5)*2.);float shade=pow(max(0.,1.-d),2.)*.34;gl_FragColor=vec4(.12,.19,.07,shade);}`} transparent depthWrite={false}/>
  </mesh>
 </group>;
}
