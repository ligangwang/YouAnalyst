import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { closeLocalCaches } from '../../src/lib/local-cache/watch';

function bundle(entry: string) {
 const code = buildSync({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'}).outputFiles[0].text;
 // Independent evaluations model separate Next server chunks in one process.
 return () => {
  const loadedModule = {exports:{} as Record<string, (...args: unknown[]) => Promise<unknown>>};
  new Function('require','module','exports',code)(createRequire(import.meta.url),loadedModule,loadedModule.exports);
  return loadedModule.exports;
 };
}

test('independent route bundles share a pending theme catalog and its published value',async()=>{
 const load=bundle('src/lib/company-themes/catalog.ts'),first=load(),second=load();let reads=0;
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const query={where:()=>query,select:()=>query,limit:()=>query,get:async()=>{reads++;await gate;return {docs:[{id:'family',data:()=>({parentId:null,names:{en:'Family','zh-CN':'Family'},order:0})}]};}};
 const db={collection:()=>query};
 const a=first.loadThemeCatalog(db),b=second.loadThemeCatalog(db);assert.equal(reads,1);
 release();assert.deepEqual(await a,await b);await second.loadThemeCatalog(db);assert.equal(reads,1);
});

test('separately bundled sitemap routes share one file load across buckets', async () => {
 const load=bundle('src/lib/local-cache/sitemaps.ts');
 const first=load(),second=load();let opens=0;
 const db={collection:()=>{throw Error('Unexpected Firestore read');}};
 const options={file:async()=>{opens++;return new Map();}};
 await Promise.all([first.loadSitemapPaths(db,'US:A',options),second.loadSitemapPaths(db,'US:M',options)]);
 assert.equal(opens,1);
});

test('separately bundled company loaders share a collection partition', async t => {
 t.after(closeLocalCaches);
 const load=bundle('src/lib/company-lookup-cache.ts');
 const first=load(),second=load();let opens=0;
 const db={},source={isEqual:(other:unknown)=>other===source,
  onSnapshot:(next:(snapshot:unknown)=>void)=>{opens++;queueMicrotask(()=>next({exists:false,data:()=>undefined}));return ()=>{};}};
 await Promise.all([first.readCompanyLookup(db,source),second.readCompanyLookup(db,source)]);
 assert.equal(opens,1);
});


test('company page read policy crosses independently bundled route and loader modules',async t=>{
 t.after(closeLocalCaches);
 const {enableCompanyDirectory,registerCompanySource}=await import('../../src/lib/local-cache/company-directory');
 let files=0,opens=0;
 const db={collection:()=>({doc:()=>source})};
 const source={id:'US:A',isEqual:(other:unknown)=>other===source,
  onSnapshot:(next:(snapshot:unknown)=>void)=>{opens++;queueMicrotask(()=>next({exists:true,data:()=>({name:'Alpha'})}));return ()=>{};}};
 enableCompanyDirectory(db as never,db as never,{file:async()=>{files++;return new Map();},sync:false});
 registerCompanySource(source,'US:A',[]);
 const scope=bundle('src/lib/local-cache/company-page-scope.ts')(),loader=bundle('src/lib/company-lookup-cache.ts')();
 await scope.withCompanyPageReads(()=>loader.readCompanyLookup(db,source));
 assert.equal(files,0);assert.equal(opens,1);
 await loader.readCompanyLookup(db,source);assert.equal(files,1,'page policy cannot leak to a later bulk request');
});
