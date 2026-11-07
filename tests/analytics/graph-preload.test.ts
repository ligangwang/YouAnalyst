import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

test('an optional graph preload failure resolves without breaking the page',async()=>{
 let load!:()=>Promise<()=>null>;
 const output=await build({entryPoints:['src/components/company-graph-preload.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external:['next/dynamic'],jsx:'automatic',plugins:[{name:'unavailable-graph',setup(bundle){
  bundle.onResolve({filter:/company-graph-3d$/},()=>({path:'unavailable',namespace:'graph-fixture'}));
  bundle.onLoad({filter:/.*/,namespace:'graph-fixture'},()=>({loader:'js',contents:'throw Error("chunk unavailable");export default function Graph(){return null}'}));
 }}]});
 const realRequire=createRequire(import.meta.url),evaluated={exports:{}};
 const injected=(name:string)=>name==='next/dynamic'?{__esModule:true,default:(loader:typeof load)=>{load=loader;return()=>null;}}:realRequire(name);
 new Function('require','module','exports',output.outputFiles[0].text)(injected,evaluated,evaluated.exports);
 assert.equal((await load())(),null);
});
