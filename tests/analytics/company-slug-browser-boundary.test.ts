import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
test('company-facing client components never bundle the full server slug inventory',async()=>{
  for(const component of ['company-search-card','most-connected-companies','company-name-resolution']){
    const result=await build({entryPoints:[`src/components/${component}.tsx`],bundle:true,platform:'browser',packages:'external',write:false,outdir:'.company-slug-boundary-check',metafile:true,loader:{'.css':'empty','.module.css':'empty'}});
    assert(!Object.keys(result.metafile!.inputs).some(path=>path.endsWith('company-url-slugs.json')),component);
  }
});
