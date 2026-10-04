import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import type {GraphNode} from '../../src/lib/knowledge-graph/model';
import {sourceDocumentsForEvents,type IntelligenceSourceDocument,type IntelligenceEvent} from '../../src/lib/intelligence/model';
const require=createRequire(import.meta.url);
const code=buildSync({stdin:{contents:`export {IntelligenceActivityOverview} from './src/components/intelligence-activity-overview'; export {CompanyAnnouncements} from './src/components/company-announcements';`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.module.css':'empty','.css':'empty'},tsconfig:'tsconfig.json'}).outputFiles[0].text;
const componentModule={exports:{}};
new Function('require','module','exports',code)(require,componentModule,componentModule.exports);
const {IntelligenceActivityOverview,CompanyAnnouncements}=componentModule.exports as typeof import('../../src/components/intelligence-activity-overview') & typeof import('../../src/components/company-announcements');
const companies=[{id:'US:A',kind:'COMPANY',stageIds:['compute']},{id:'US:B',kind:'COMPANY',stageIds:['memory']}] as GraphNode[];
const source=(url:string,channel:'SEC'|'IR')=>({id:url,url,title:url,channel,sourceDate:'2026-10-01'});
const events=[{id:'one',title:'Results',publication_date:'2026-10-01',companyIds:['US:A','US:B'],evidence:[source('https://example.com/one','SEC'),source('https://example.com/two','IR')]},{id:'two',title:'Results citation',publication_date:'2026-10-01',companyIds:['US:A'],evidence:[source('https://example.com/one','SEC')]}] as IntelligenceEvent[];
function render(sourceFilter:'SEC'|''='',documents?:IntelligenceSourceDocument[],complete=true){return renderToStaticMarkup(createElement(IntelligenceActivityOverview,{events,documents,complete,companies,recentFallback:true,period:'recent',sourceFilter,limit:200,truncated:true,onSector(){},onSource(){},onEvent(){}}));}
test('source overview distinguishes full-period totals from the capped feed',()=>{
 const html=render();assert(html.includes('Last 30 days'));assert(html.includes('Latest 200 entries shown; totals include all recorded sources in this period.'));assert(!html.includes('Clusters'));assert(!html.includes('Loaded · 30d'));assert.match(html,/<details[^>]*><summary>Sector breakdown<\/summary>/);assert(html.includes('A document can appear in multiple sectors.'));assert.match(html,/<strong>2<\/strong><span>Source documents<\/span>/);
});

test('latest earnings link and sourced quarter figures stay separate from annual financials and newer releases',()=>{
 const items=[{id:'ir',title:'Quarterly results',url:'https://investors.micron.com/results',date:'2026-09-30',channel:'IR' as const,earnings:true}];
 const summary={companyId:'US:MU',title:'SEC results exhibit',url:'https://www.sec.gov/results',publishedDate:'2026-09-30',period:{start:'2026-05-29',end:'2026-09-03',type:'quarter' as const,fiscalYear:2026,fiscalQuarter:4},metrics:[{name:'revenue' as const,value:54_229_000_000,unit:'USD',basis:'US_GAAP' as const}]};
 const html=renderToStaticMarkup(createElement(CompanyAnnouncements,{items,earningsSummary:summary}));
 assert(html.includes('Latest earnings'));assert(html.includes('FY2026 Q4'));assert(html.includes('54.23B'));assert(html.includes('2026-09-03'));assert(html.includes('US GAAP'));assert(html.includes('Financial figures source'));
 const newer=renderToStaticMarkup(createElement(CompanyAnnouncements,{items:[{...items[0],date:'2026-12-30'}],earningsSummary:summary}));
 assert(newer.includes('2026-12-30'));assert(!newer.includes('54.23B'));
 const undated={...summary,publishedDate:null,url:'https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/ex991.htm'};
 const filing={...items[0],id:'filing',channel:'SEC' as const,url:'https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/mu-20260930.htm'};
 const matched=renderToStaticMarkup(createElement(CompanyAnnouncements,{items:[filing],earningsSummary:undated}));
 assert(matched.includes('54.23B'));assert(matched.includes('2026-09-30'));assert(matched.includes('Financial figures source'));
 for(const unmatched of [[{...filing,url:filing.url.replace('000072312526000018','000072312526000019')}],[filing,{...items[0],date:'2026-12-30'}]])assert(!renderToStaticMarkup(createElement(CompanyAnnouncements,{items:unmatched,earningsSummary:undated})).includes('54.23B'));
});
test('document counts deduplicate source URLs and honor the selected source channel',()=>{
 const html=render('SEC');assert.match(html,/<strong>1<\/strong><span>Source documents<\/span>/);assert(!html.includes('IR<strong>'));assert.match(html,/AI compute<\/span>.*?<strong>1<\/strong>/);assert.match(html,/Memory &amp; storage<\/span>.*?<strong>1<\/strong>/);
});

test('headline and sector totals exceed the feed cap and incomplete reads are explicitly marked',()=>{
 const documents=Array.from({length:350},(_,index)=>({...sourceDocumentsForEvents(events)[0],id:`https://example.com/full-${index}`,companyIds:['US:A']}));
 const html=render('',documents);assert.match(html,/<strong>350<\/strong><span>Source documents<\/span>/);assert.match(html,/AI compute<\/span>.*?<strong>350<\/strong>/);
 const partial=render('',documents,false);assert(partial.includes('Partial data'));assert(partial.includes('totals are partial.'));
});
