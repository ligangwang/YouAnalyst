import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

async function startup(runtime:string,environment:string,failure?:Error){
 const calls:string[]=[];
 const result=await build({entryPoints:['src/instrumentation.ts'],bundle:true,write:false,platform:'node',format:'cjs',supported:{'dynamic-import':false},
  define:{'process.env.NEXT_RUNTIME':JSON.stringify(runtime),'process.env.NODE_ENV':JSON.stringify(environment)},
  external:['firebase-admin/firestore']});
 const loadedModule={exports:{} as {register:()=>Promise<void>}};
 new Function('require','module','exports',result.outputFiles[0].text)((name:string)=>{
  calls.push(name);assert.equal(name,'firebase-admin/firestore','startup must not import route or data loaders');
  if(failure)throw failure;
  return {getFirestore:()=>{throw Error('Startup opened a database client');},Firestore:class{constructor(){throw Error('Startup constructed a database client');}}};
 },loadedModule,loadedModule.exports);
 return {calls,register:loadedModule.exports.register};
}

test('production readiness awaits the shared SDK import without opening any data client',async()=>{
 const app=await startup('nodejs','production');
 assert.deepEqual(app.calls,[]);
 await app.register();
 assert.deepEqual(app.calls,['firebase-admin/firestore']);
});

test('edge and development startup do not load the Node SDK',async()=>{
 for(const [runtime,environment] of [['edge','production'],['nodejs','development']]){
  const app=await startup(runtime,environment);await app.register();assert.deepEqual(app.calls,[]);
 }
});

test('startup awaits import failures instead of leaving work running behind readiness',async()=>{
 const failure=new Error('SDK unavailable'),app=await startup('nodejs','production',failure);
 await assert.rejects(app.register(),error=>error===failure);
});

