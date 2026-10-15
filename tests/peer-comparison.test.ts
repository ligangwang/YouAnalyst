import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPeerComparison,peerGroup} from '../src/lib/peer-comparison/model';
import type {GraphNode} from '../src/lib/knowledge-graph/model';
const today='2026-10-14';
const node=(id:string,stage='compute',privateCompany=false):GraphNode=>({id,name:id,kind:'COMPANY',order:0,stageIds:[stage],listingStatus:privateCompany?'PRIVATE':'PUBLIC'});
const annual=(profit:number,end='2025-12-31',start='2025-01-01',unit='USD')=>({report:{end,form:'10-K'},metrics:[{label:'Net income',value:profit,unit,start,end},{label:'Revenue',value:100,unit,start,end},{label:'Diluted EPS',value:2,unit:`${unit}/shares`,start,end}]});
const cap=(value:number,date=today)=>({status:'estimated',value,currency:'USD',priceDate:date});
test('peers use the recorded role and same listing market, excluding private and unclassified companies',()=>{
 const group=peerGroup('US:A',[node('US:A'),node('US:B'),node('US:C','memory'),node('US:D','compute',true),node('XSHE:000001')]);
 assert.deepEqual(group?.companies.map(c=>c.id),['US:A','US:B']);assert.equal(peerGroup('US:X',[node('US:X','missing')]),null);
});
test('market caps share one price date; missing values stay missing and ties share ranks',()=>{
 const nodes=['A','B','C','D','E'].map(id=>node('US:'+id));
 const docs=new Map<string,unknown>([['US:A',{marketCap:cap(200)}],['US:B',{marketCap:cap(200)}],['US:C',{marketCap:cap(100)}],['US:D',{marketCap:cap(999,'2026-10-13')}]]);
 const result=buildPeerComparison('US:A',nodes,docs,new Map(),today)!;const panel=result.panels[0];
 assert.equal(panel.count,3);assert.equal(panel.median,200);assert(Math.abs(panel.mean-500/3)<1e-9);assert.deepEqual(panel.rows.map(r=>r.rank),[1,1,3,null,null]);assert.equal(result.total,5);
});
test('annual comparisons retain losses and zero, require full-year matching currency, and reject distant periods',()=>{
 const nodes=['A','B','C','D','E','F'].map(id=>node('US:'+id));
 const docs=new Map<string,unknown>([['US:A',{value:annual(0)}],['US:B',{value:annual(-20)}],['US:C',{value:annual(40,'2026-01-31','2025-02-01')}],['US:D',{value:annual(100,'2024-12-31','2024-01-01')}],['US:E',{value:annual(100,'2025-12-31','2025-10-01')}],['US:F',{value:annual(100,'2025-12-31','2025-01-01','EUR')}] ]);
 const panel=buildPeerComparison('US:A',nodes,docs,new Map(),today)!.panels.find(p=>p.key==='profit')!;
 assert.equal(panel.count,3);assert.equal(panel.median,0);assert.deepEqual(panel.rows.slice(0,3).map(r=>r.observation!.value),[40,0,-20]);assert.equal(panel.rows.find(r=>r.id==='US:D')!.observation,null);
});
test('A-share float capitalization uses tradable A-shares rather than total shares; EPS needs supported annual share basis',()=>{
 const docs=new Map<string,unknown>([['XSHE:000001',{marketCap:{...cap(1000),currency:'CNY',close:10,shares:{aShares:100,aTradableShares:60,totalShares:500}},cnAnnual:{end:'2025-12-31',metrics:[{label:'Net income attributable to parent',value:20,unit:'CNY',start:'2025-01-01',end:'2025-12-31'}]}}]]);
 const result=buildPeerComparison('XSHE:000001',[node('XSHE:000001')],docs,new Map(),today)!;
 assert.equal(result.panels.find(p=>p.key==='floatMarketCap')!.rows[0].observation!.value,600);assert.equal(result.panels.find(p=>p.key==='profit')!.rows[0].observation!.value,20);assert.equal(result.panels.some(p=>p.key==='eps'),false);
 const us=annual(10);us.report.form='20-F';assert.equal(buildPeerComparison('US:A',[node('US:A')],new Map([['US:A',{value:us}]]),new Map(),today)!.panels.some(p=>p.key==='eps'),false);
});
test('five-session returns require all six shared adjusted closes and never bridge a missing trading session',()=>{
 const dates=['2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13','2026-10-14'];
 const bars=(ticker:string)=>dates.map((tradingDate,i)=>({ticker,market:'US',tradingDate,close:100+i}));
 const a=bars('A'),b=bars('B').filter((_,i)=>i!==2);b.unshift({ticker:'B',market:'US',tradingDate:'2026-10-06',close:90});
 const result=buildPeerComparison('US:A',[node('US:A'),node('US:B')],new Map(),new Map([['US:A',a],['US:B',b]]),today)!;const panel=result.panels.find(p=>p.key==='fiveDayReturn')!;
 assert.equal(panel.count,1);assert(Math.abs(panel.rows[0].observation!.value-5)<1e-9);assert.equal(panel.rows[1].observation,null);assert.equal(panel.start,dates[0]);
});
test('unsupported or empty data produces no misleading metric panels',()=>{
 assert.deepEqual(buildPeerComparison('US:A',[node('US:A')],new Map(),new Map(),today)!.panels,[]);
 assert.equal(buildPeerComparison('ORG:PRIVATE',[node('ORG:PRIVATE')],new Map(),new Map(),today),null);
 const result=buildPeerComparison('US:A',[node('US:A')],new Map([['US:A',{marketCap:cap(100,'2026-10-15')}]]),new Map(),today)!;assert.equal(result.panels.length,0);
});
