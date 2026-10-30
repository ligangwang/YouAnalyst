import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

test('preview images read structure inside page scope without valuations or full snapshots',async()=>{
 const result=await build({entryPoints:['src/app/api/research-preview-image/route.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',plugins:[{name:'preview-dependencies',setup(builder){
  builder.onResolve({filter:/(company-neighborhood|company-document-cache|firebase\/admin|company-page-scope|company-themes\/catalog|next\/og)$/},args=>({path:args.path,namespace:'preview'}));
  builder.onLoad({filter:/.*/,namespace:'preview'},args=>({loader:'ts',contents:
   args.path.endsWith('company-page-scope')?`import {AsyncLocalStorage} from 'node:async_hooks';export const scope=new AsyncLocalStorage();export const withCompanyPageReads=work=>scope.run(true,work);`:
   args.path.endsWith('company-neighborhood')?`import {scope} from '@/lib/local-cache/company-page-scope';export async function loadCompanyNeighborhood(db,id,data){if(!scope.getStore()||id!=='US:AMD'||data.name!=='AMD')throw Error('Wrong neighborhood');return {nodes:[{id,kind:'COMPANY',name:data.name,names:{en:data.name}}],relationships:[],sources:[],asOf:'2026-10-30'}}`:
   args.path.endsWith('company-document-cache')?`import {scope} from '@/lib/local-cache/company-page-scope';export async function loadCompanyDocuments(db,collection,ids){if(!scope.getStore()||collection!=='companies'||JSON.stringify(ids)!=='["US:AMD"]')throw Error('Unnecessary data read');return [{data:()=>({name:'AMD'})}]}`:
   args.path.endsWith('admin')?`export const getAdminFirestore=()=>({});`:
   args.path.endsWith('catalog')?`export async function loadThemeCatalog(){return [{id:'technology',parentId:null},{id:'ai',parentId:'technology'}]}`:
   `export class ImageResponse {constructor(tree){this.tree=tree}}`}));
 }}]});
 const loadedModule={exports:{} as {GET:(request:Request)=>Promise<{tree:unknown}>}};
 new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),loadedModule,loadedModule.exports);
 const resultImage=await loadedModule.exports.GET(new Request('https://example.test/api/research-preview-image?company=US:AMD'));
 assert.match(JSON.stringify(resultImage.tree),/AMD/);
 assert.match(JSON.stringify(resultImage.tree),/2026-10-30/);
 const unpublished=await loadedModule.exports.GET(new Request('https://example.test/api/research-preview-image?company=US:AMD&theme=unpublished'));
 assert.doesNotMatch(JSON.stringify(unpublished.tree),/AMD/);
});
