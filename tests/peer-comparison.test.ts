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
test('non-NVIDIA historical splits use provider-adjusted closes and invalid adjusted values stay unavailable',()=>{
 const dates=['2026-10-07','2026-10-08','2026-10-09','2026-10-12','2026-10-13','2026-10-14'];
 const rows=(ticker:string)=>dates.map((tradingDate,i)=>({ticker,market:'US',tradingDate,close:i<3?200+i*2:100+i,rawClose:i<3?200+i*2:100+i,adjustedClose:100+i,source:'eodhd-eod'}));
 const a=rows('A'),b=rows('B');b[2].adjustedClose=0;
 const panel=buildPeerComparison('US:A',[node('US:A'),node('US:B')],new Map(),new Map([['US:A',a],['US:B',b]]),today)!.panels.find(p=>p.key==='fiveDayReturn')!;
 assert.equal(panel.count,1);assert(Math.abs(panel.rows[0].observation!.value-5)<1e-9);assert.equal(panel.rows[1].observation,null);
 const missing=a.map(row=>({...row,adjustedClose:undefined}));assert.equal(buildPeerComparison('US:A',[node('US:A')],new Map(),new Map([['US:A',missing]]),today)!.panels.length,0);
});


test('peer price history watches the exact bounded query and pushes corrections',async(t)=>{
 const {loadPeerPrices}=await import('../src/lib/peer-comparison/price-cache');
 const {observeFirestore}=await import('../src/lib/firebase/firestore-observability');
 const {closeLocalCaches}=await import('../src/lib/local-cache/watch');t.after(closeLocalCaches);
 let opens=0,value=1;const listeners=new Map<string,(snapshot:unknown)=>void>();const bounds:unknown[][]=[];
 const snapshot=()=>({docs:[{id:'price',data:()=>({rawClose:value})}],docChanges:()=>[{type:'modified',doc:{id:'price'}}]});
 const query=(clauses:unknown[][]=[])=>({path:'eod_prices',key:JSON.stringify(clauses),
  isEqual(other:{key:string}){return this.key===other.key;},
  where(...args:unknown[]){bounds.push(args);return query([...clauses,args]);},
  orderBy(...args:unknown[]){return query([...clauses,args]);},limit(n:number){assert.equal(n,12);return query([...clauses,[n]]);},
  get:async()=>{throw Error('No polling queries');},
  onSnapshot(next:(snapshot:unknown)=>void){opens++;listeners.set(this.key,next);queueMicrotask(()=>next(snapshot()));return ()=>{listeners.delete(this.key);};}
 });
 const db=observeFirestore({collection:(name:string)=>{assert.equal(name,'eod_prices');return query();}} as unknown as import('firebase-admin/firestore').Firestore,()=>{});
 const load=()=>loadPeerPrices(db,'US:AMD','US','2026-10-18');
 const [first,second]=await Promise.all([load(),load()]);assert.deepEqual(first,second);assert.equal(opens,1);
 value=2;for(const next of listeners.values())next(snapshot());assert.equal((await load())[0].rawClose,2);assert.equal(opens,1);
 assert.equal(bounds[0][2],'US_AMD_');assert.equal(bounds[1][2],'US_AMD_2026-10-18');
 await loadPeerPrices(db,'XSHE:000001','CN_A','2026-10-18');assert.equal(opens,2,'different company must have its own query');
});
