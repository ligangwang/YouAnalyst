import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import type {GraphNode} from '../../src/lib/knowledge-graph/model';
import type {IntelligenceEvent} from '../../src/lib/intelligence/model';
const require=createRequire(import.meta.url);
const code=buildSync({stdin:{contents:`export {IntelligenceActivityOverview} from './src/components/intelligence-activity-overview';`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.module.css':'empty','.css':'empty'},tsconfig:'tsconfig.release-check.json'}).outputFiles[0].text;
const componentModule={exports:{}};
new Function('require','module','exports',code)(require,componentModule,componentModule.exports);
const {IntelligenceActivityOverview}=componentModule.exports as typeof import('../../src/components/intelligence-activity-overview');
const companies=[{id:'US:A',kind:'COMPANY',stageIds:['compute']},{id:'US:B',kind:'COMPANY',stageIds:['memory']}] as GraphNode[];
const source=(url:string,channel:'SEC'|'IR')=>({id:url,url,title:url,channel,sourceDate:'2026-10-01'});
const events=[{id:'one',title:'Results',publication_date:'2026-10-01',companyIds:['US:A','US:B'],evidence:[source('https://example.com/one','SEC'),source('https://example.com/two','IR')]},{id:'two',title:'Results citation',publication_date:'2026-10-01',companyIds:['US:A'],evidence:[source('https://example.com/one','SEC')]}] as IntelligenceEvent[];
function render(sourceFilter:'SEC'|''=''){return renderToStaticMarkup(createElement(IntelligenceActivityOverview,{events,companies,recentFallback:true,period:'recent',sourceFilter,limit:200,truncated:true,onSector(){},onSource(){},onEvent(){}}));}
test('source overview discloses capped loaded scope and removes misleading event totals',()=>{
 const html=render();assert(html.includes('Loaded · 30d'));assert(html.includes('Feed limited to 200 entries; counts cover loaded sources only.'));assert(!html.includes('Clusters'));assert(!html.includes('Last 30 days'));assert(html.includes('Source documents by sector'));assert(html.includes('A document can appear in multiple sectors.'));assert.match(html,/<strong>2<\/strong><span>Source documents<\/span>/);
});
test('document counts deduplicate source URLs and honor the selected source channel',()=>{
 const html=render('SEC');assert.match(html,/<strong>1<\/strong><span>Source documents<\/span>/);assert(!html.includes('IR<strong>'));assert.match(html,/AI compute<\/span>.*?<strong>1<\/strong>/);assert.match(html,/Memory &amp; storage<\/span>.*?<strong>1<\/strong>/);
});
