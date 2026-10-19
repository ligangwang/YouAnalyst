import {DoubleSide,MeshStandardMaterial,type Texture} from 'three';

export function createMeadowClock(){
 const time={value:0},wind={value:0};
 return {time,wind,setWind:(value:number)=>{wind.value=value;},advance:(delta:number)=>{time.value+=Math.max(0,Math.min(.1,delta));}};
}
export type MeadowClock=ReturnType<typeof createMeadowClock>;

/** One shared GPU material per plant type; wind never moves company hit targets. */
export function meadowMaterial(clock:MeadowClock,map:Texture|null,leaf=false){
 const material=new MeshStandardMaterial({map,alphaTest:map?.5:0,side:DoubleSide,roughness:leaf?.85:.9,metalness:0,emissive:leaf?'#203b2b':'#182c04',emissiveIntensity:leaf?.05:.07});
 material.onBeforeCompile=shader=>{
  shader.uniforms.meadowTime=clock.time;shader.uniforms.meadowWind=clock.wind;
  shader.vertexShader='uniform float meadowTime; uniform float meadowWind;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   #ifdef USE_INSTANCING
    float phase=dot(instanceMatrix[3].xz,vec2(.007,.011));
    float tip=clamp(position.y,0.,1.5);
    float breeze=sin(meadowTime*.85+phase)+.35*sin(meadowTime*1.7+phase*1.8);
    transformed.x+=breeze*tip*tip*meadowWind*${leaf?'.055':'.12'};
    transformed.z+=cos(meadowTime*.6+phase)*tip*meadowWind*.035;
   #endif`);
  if(leaf)shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   // A thin-leaf backlight approximation keeps the canopy luminous from its shaded side.
   totalEmissiveRadiance+=diffuseColor.rgb*(gl_FrontFacing?.025:.09);`);
 };
 material.customProgramCacheKey=()=>leaf?'meadow-leaf-wind-v1':'meadow-grass-wind-v1';
 return material;
}
