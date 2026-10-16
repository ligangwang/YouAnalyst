import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEvent,eventPresentation} from '../src/lib/events/classification';
import {parseInsiderTransactions,validInsiderGroup} from '../src/lib/events/insider-transactions';
import {groupCompanyAnnouncements} from '../src/lib/intelligence/announcement-grouping';
import {mergeIntelligenceEvents} from '../src/lib/intelligence/project';
import {ownershipXmlUrl,backfillEventClassifications} from '../src/lib/events/classification-worker';
import type {IntelligenceEvent} from '../src/lib/intelligence/model';
import type {Firestore} from 'firebase-admin/firestore';
const xml=(code='P',owner='123',form='4',shares='100')=>`<ownershipDocument><documentType>${form}</documentType><issuer><issuerTradingSymbol>AMD</issuerTradingSymbol></issuer><reportingOwner><reportingOwnerId><rptOwnerCik>${owner}</rptOwnerCik><rptOwnerName>Owner</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common stock</value></securityTitle><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>100</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${code==='S'?'D':'A'}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
test('headlines distinguish scheduled earnings, results and relationship changes; forms alone never imply buys',()=>{
 assert.equal(classifyEvent({title:'AMD to Report Fiscal Third Quarter 2026 Financial Results'}).eventSubtype,'earnings_scheduled');
 assert.equal(classifyEvent({title:'AMD Reports Third Quarter Financial Results'}).eventSubtype,'earnings_results');
 assert.equal(classifyEvent({form:'4'}).eventSubtype,'insider_ownership');
 assert.equal(classifyEvent({form:'144'}).eventSubtype,'insider_planned_sale');
 assert.equal(classifyEvent({title:'AMD Expands Partnership with Example'}).eventSubtype,'relationship_expanded');
 assert.notEqual(eventPresentation({eventType:'insider_trade',eventSubtype:'insider_buy'}).symbol,eventPresentation({eventType:'insider_trade',eventSubtype:'insider_sell'}).symbol);
});
test('ownership XML distinguishes transaction codes and rejects missing identity, issuer mismatch and external entities',()=>{
 for(const [code,subtype] of [['P','insider_buy'],['S','insider_sell'],['A','insider_award'],['M','insider_exercise'],['F','insider_withholding']]){
  const group=parseInsiderTransactions(xml(code),'US:AMD')[0];assert.equal(group.eventSubtype,subtype);assert.equal(validInsiderGroup(group,'US:AMD'),true);assert.equal(validInsiderGroup(group,'US:NVDA'),false);
 }
 assert.throws(()=>parseInsiderTransactions(xml(),'US:NVDA'));
 assert.throws(()=>parseInsiderTransactions('<!DOCTYPE ownershipDocument>'+xml(),'US:AMD'));
 assert.throws(()=>parseInsiderTransactions(xml().replace('2026-10-01','2026-02-30'),'US:AMD'));
 assert.throws(()=>parseInsiderTransactions(xml().replace('<transactionCode>P','<transactionCode>S'),'US:AMD'));
});
const event=(id:string,document:string,date:string,code='P',owner='123',form='4',shares='100'):IntelligenceEvent=>{
 const g=parseInsiderTransactions(xml(code,owner,form,shares),'US:AMD')[0];
 return {...g,insiderTransactions:g.transactions,id,origin:'US:AMD',companyIds:['US:AMD'],edgeIds:[],category:'FILING',title:'AMD ownership',summary:'Official disclosure.',published_at:null,publication_date:date,eventDate:'2026-10-01',planned:false,amendmentPublishedAt:g.amendment?date:undefined,evidence:[{id:document,url:`https://example.com/${document}`,title:'Form 4',sourceDate:date,channel:'SEC'}]};
};
test('same insider transaction retains reference documents, distinct insiders and directions stay separate',()=>{
 const original=event('original','a','2026-10-02');const copy=event('copy','b','2026-10-03');
 assert.equal(groupCompanyAnnouncements([original,copy]).length,1);
 assert.equal(groupCompanyAnnouncements([original,copy])[0].evidence.length,2);
 assert.equal(groupCompanyAnnouncements([original,event('sell','s','2026-10-02','S'),event('other','o','2026-10-02','P','456')]).length,3);
 const amended=event('amended','c','2026-10-04','P','123','4/A','200');
 for(const items of [[amended,copy,original],[original,copy,amended]]){
  const result=groupCompanyAnnouncements(items)[0];assert.equal(result.publication_date,'2026-10-02');assert.equal(result.insiderTransactions?.[0].shares,'200');assert.equal(result.evidence.length,3);
 }
 const sell=event('sell','a','2026-10-02','S');assert.equal(mergeIntelligenceEvents([original,sell,{...original,eventGroupingKey:undefined,insiderTransactions:undefined}],[]).length,2);
});
test('ownership URL validation bounds fetches to official raw XML',()=>{
 assert.equal(ownershipXmlUrl('https://www.sec.gov/Archives/edgar/data/123/000000000000000001/xslF345X05/owner.xml'),'https://www.sec.gov/Archives/edgar/data/123/000000000000000001/owner.xml');
 for(const url of ['https://example.com/a.xml','https://www.sec.gov/Archives/edgar/data/123/000000000000000001/owner.xml?redirect=evil','http://www.sec.gov/a.xml'])assert.throws(()=>ownershipXmlUrl(url));
});
test('migration dry run writes nothing; apply preserves publication and processing timestamps and is idempotent',async()=>{
 let writes=0;const row:Record<string,unknown>={type:'company_news',title:'AMD Reports Third Quarter Financial Results',published_at:'2026-10-02T10:00:00Z',processed_at:'2026-10-03T10:00:00Z'};
 const doc={id:'a',ref:{id:'a'},exists:true,data:()=>row,get:(key:string)=>row[key]};
 const query={orderBy:()=>query,limit:()=>query,startAfter:()=>query,get:async()=>({docs:[doc],size:1,empty:false})};
 const db={collection:(name:string)=>name==='events'?query:{doc:()=>({set:async()=>{writes++;}})},runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:async()=>doc,set:(ref:unknown,patch:Record<string,unknown>)=>{writes++;if(ref===doc.ref)Object.assign(row,patch);},update:(_ref:unknown,patch:Record<string,unknown>)=>{writes++;Object.assign(row,patch);}})} as unknown as Firestore;
 const preview=await backfillEventClassifications(db,{apply:false});assert.equal(preview.updated,1);assert.equal(writes,0);
 assert.equal((await backfillEventClassifications(db,{apply:true})).updated,1);
 assert.equal(row.published_at,'2026-10-02T10:00:00Z');assert.equal(row.processed_at,'2026-10-03T10:00:00Z');
 assert.equal((await backfillEventClassifications(db,{apply:true})).updated,0);
});
