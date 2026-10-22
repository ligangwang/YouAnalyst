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
