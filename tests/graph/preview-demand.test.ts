import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

test('preview images read structure inside page scope without valuations or full snapshots',async()=>{
 const result=await build({entryPoints:['src/app/api/research-preview-image/route.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',plugins:[{name:'preview-dependencies',setup(builder){
  builder.onResolve({filter:/(graph-service|company-page-scope|company-themes\/catalog|next\/og)$/},args=>({path:args.path,namespace:'preview'}));
  builder.onLoad({filter:/.*/,namespace:'preview'},args=>({loader:'ts',contents:
   args.path.endsWith('company-page-scope')?`import {AsyncLocalStorage} from 'node:async_hooks';export const scope=new AsyncLocalStorage();export const withCompanyPageReads=work=>scope.run(true,work);`:
   args.path.endsWith('graph-service')?`import {scope} from '@/lib/local-cache/company-page-scope';export async function loadThemeGraph(){throw Error('Unexpected valuation read')}export async function loadThemeGraphStructure(){if(!scope.getStore())throw Error('Full snapshot read');return {nodes:[{id:'US:AMD',kind:'COMPANY',name:'AMD',names:{en:'AMD'}}],relationships:[],sources:[],asOf:'2026-10-30'}}`:
   args.path.endsWith('catalog')?`export async function loadThemeCatalog(){return []}`:
   `export class ImageResponse {constructor(tree){this.tree=tree}}`}));
 }}]});
 const loadedModule={exports:{} as {GET:(request:Request)=>Promise<{tree:unknown}>}};
 new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),loadedModule,loadedModule.exports);
 const resultImage=await loadedModule.exports.GET(new Request('https://example.test/api/research-preview-image?company=US:AMD'));
 assert.match(JSON.stringify(resultImage.tree),/AMD/);
 assert.match(JSON.stringify(resultImage.tree),/2026-10-30/);
});

