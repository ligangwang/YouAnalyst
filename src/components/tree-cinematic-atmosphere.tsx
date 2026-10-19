"use client";

import {useEffect,useMemo,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {AdditiveBlending,BufferGeometry,DoubleSide,Float32BufferAttribute,Vector3} from 'three';
import {verticalJitter as jitter,VERTICAL_SOIL_Y} from '@/lib/ui/knowledge-graph/vertical-tree';
import type {MeadowClock} from '@/lib/ui/knowledge-graph/tree-cinematic-material';

const noHit=()=>{};
const vertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/** Soft object-space moonbeams, fireflies and twinkling stars in three draw calls, without a full-screen post pass. */
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
  // (firefly drift and star twinkle) requests at most 20 fps; camera gestures/tours can render independently.
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
 // Most fireflies drift through the crown; the rest hover just above the grass.
 const fireflies=useMemo(()=>{
  const points:number[]=[],seeds:number[]=[];
  for(let i=0;i<420;i++){
   const id='firefly'+i,a=jitter(id)*Math.PI*2,crown=i%5<3;
   const r=crown?250+Math.sqrt(jitter(id,1))*1500:400+Math.sqrt(jitter(id,1))*3600;
   const y=crown?height*(.35+jitter(id,2)*.55):VERTICAL_SOIL_Y+30+jitter(id,2)*jitter(id,4)*420;
   points.push(Math.cos(a)*r,y,Math.sin(a)*r);seeds.push(jitter(id,3));
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setAttribute('seed',new Float32BufferAttribute(seeds,1));geometry.setDrawRange(0,size.width<640?160:420);return geometry;
 },[height,size.width]);
 // Stars sit just inside the sky dome, beyond the mountains, and never below their ridges.
 const stars=useMemo(()=>{
  const points:number[]=[],seeds:number[]=[];
  for(let i=0;i<2400;i++){
   const id='star'+i,a=jitter(id)*Math.PI*2,lift=.05+.95*Math.sqrt(jitter(id,1)),ring=Math.sqrt(1-lift*lift);
   points.push(Math.cos(a)*ring*58000,lift*58000,Math.sin(a)*ring*58000);seeds.push(jitter(id,2));
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.setAttribute('seed',new Float32BufferAttribute(seeds,1));geometry.computeBoundingSphere();return geometry;
 },[]);
 useEffect(()=>()=>shafts.dispose(),[shafts]);
 useEffect(()=>()=>fireflies.dispose(),[fireflies]);
 useEffect(()=>()=>stars.dispose(),[stars]);
 const uniforms=useMemo(()=>({time:clock.time,wind:clock.wind,height:{value:height}}),[clock,height]);
 return <group name="cinematic-atmosphere">
  <mesh geometry={shafts} raycast={noHit} renderOrder={2}>
   <shaderMaterial uniforms={uniforms} vertexShader={vertex} fragmentShader={`varying vec2 vUv;uniform float time;uniform float wind;void main(){float edge=pow(sin(vUv.x*3.14159265),1.8);float fade=smoothstep(0.,.18,vUv.y)*(1.-smoothstep(.65,1.,vUv.y));float veil=.88+.12*sin(vUv.y*19.+time*.18*wind);gl_FragColor=vec4(.62,.7,1.,edge*fade*veil*.045);}`} transparent depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false}/>
  </mesh>
  <points geometry={stars} raycast={noHit} renderOrder={-1}>
   <shaderMaterial uniforms={uniforms} vertexShader={`attribute float seed;uniform float time;varying float alpha;varying float shine;varying vec3 tint;void main(){shine=step(.93,seed);float twinkle=.55+.45*sin(time*(.8+seed*1.6)+seed*90.);alpha=(.35+.6*fract(seed*7.31))*mix(1.,twinkle,.7)*smoothstep(.05,.2,position.y/58000.);tint=mix(vec3(.75,.82,1.),vec3(1.,.88,.74),step(.85,fract(seed*13.7)));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=mix(1.6+fract(seed*3.7)*1.6,7.+seed*3.,shine);}`} fragmentShader={`varying float alpha;varying float shine;varying vec3 tint;void main(){vec2 p=gl_PointCoord-.5;float r=length(p);float dotGlow=1.-smoothstep(.1,.5,r);float rays=(exp(-abs(p.x)*60.)+exp(-abs(p.y)*60.))*(1.-smoothstep(0.,.5,r));float a=mix(dotGlow,exp(-r*r*110.)+rays*.45+dotGlow*.12,shine)*alpha;if(a<.01)discard;gl_FragColor=vec4(tint,a);}`} transparent depthWrite={false} toneMapped={false}/>
  </points>
  <points geometry={fireflies} raycast={noHit}>
   <shaderMaterial uniforms={uniforms} vertexShader={`attribute float seed;uniform float time;uniform float wind;varying float alpha;void main(){vec3 p=position;float t=time*wind;p.x+=sin(t*.35+seed*36.)*70.;p.y+=sin(t*.5+seed*51.)*45.;p.z+=cos(t*.28+seed*28.)*60.;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((55.+seed*40.)*550./max(1.,-mv.z),2.5,26.);alpha=(.45+.55*seed)*(.35+.65*pow(.5+.5*sin(t*(1.2+seed*1.8)+seed*70.),2.));}`} fragmentShader={`varying float alpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float core=exp(-d*d*28.);float halo=pow(1.-d,2.)*.55;gl_FragColor=vec4(mix(vec3(1.,.74,.3),vec3(1.,.97,.8),core),(core+halo)*alpha);}`} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false}/>
  </points>
  {/* Ground contact remains soft and local instead of requiring a shadow-map pass. */}
  <mesh position={[0,VERTICAL_SOIL_Y+2,0]} rotation={[-Math.PI/2,0,0]} raycast={noHit}>
   <planeGeometry args={[3000,2400]}/><shaderMaterial vertexShader={vertex} fragmentShader={`varying vec2 vUv;void main(){float d=length((vUv-.5)*2.);float shade=pow(max(0.,1.-d),2.)*.34;gl_FragColor=vec4(.12,.19,.07,shade);}`} transparent depthWrite={false}/>
  </mesh>
 </group>;
}
