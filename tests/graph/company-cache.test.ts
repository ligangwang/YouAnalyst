import {withThemeCatalog} from '../helpers/theme-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore, Timestamp} from 'firebase-admin/firestore';
import {loadThemeEnrolledCompanies,loadSingleThemeCompanies} from '../../src/lib/knowledge-graph/company-cache';
import {closeLocalCaches} from '../../src/lib/local-cache/watch';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory,refreshCompanyDirectoryIds,withPageEntityReads} from '../../src/lib/local-cache/company-directory';
import {graphFromMarket, type MarketCompany} from '../../src/lib/knowledge-graph/market-store';
import {themedGraph} from '../../src/lib/company-themes/presentation';

test('single-theme cold reads share only the requested subscription and do not block other themes',async(t)=>{
 t.after(closeLocalCaches);
 const pushes=new Map<string,(snapshot:unknown)=>void>();
 const subscriptions:string[]=[];
 let files=0;
 const db={collection:(collection:string)=>{
  assert.equal(collection,'companies');
  return {where:(field:string,op:string,theme:string)=>{
   assert.equal(field,'themeIds');assert.equal(op,'array-contains');
   return {theme,isEqual:(other:{theme:string})=>other.theme===theme,onSnapshot:(next:(snapshot:unknown)=>void)=>{subscriptions.push(theme);pushes.set(theme,next);return ()=>{};}};
  }};
 }} as unknown as Firestore;
 enableCompanyDirectory(db,db,{file:async()=>{files++;throw Error('Themed graph downloaded the market');}});
 const pending=Array.from({length:12},()=>loadSingleThemeCompanies(db,'robotics'));
 const space=loadSingleThemeCompanies(db,'space');
 const doc=(id:string,data:Record<string,unknown>)=>({id,data:()=>data});
 pushes.get('space')!({docs:[doc('US:S',{name:'Space'})]});
 assert.deepEqual((await space).docs.map(row=>row.id),['US:S']);
 // Robotics is still waiting: an independent request has already completed.
 pushes.get('robotics')!({docs:[doc('US:R',{name:'Robot'}),doc('US:D',{isDeleted:true})]});
 for(const snapshot of await Promise.all(pending))assert.deepEqual(snapshot.docs.map(row=>row.id),['US:R']);
 pushes.get('robotics')!({docs:[doc('US:N',{name:'New member'})]});
 assert.deepEqual((await loadSingleThemeCompanies(db,'robotics')).docs.map(row=>row.id),['US:N']);
 pushes.get('robotics')!({docs:[]});
 assert.equal((await loadSingleThemeCompanies(db,'robotics')).docs.length,0);
 assert.deepEqual(subscriptions,['robotics','space']);assert.equal(files,0);
});

test('concurrent graph reads avoid search payloads, preserve presentation, and observe writes during file load',async()=>{
 let prefixes=0,loads=0,start!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{start=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const company={name:'Alpha',status:'PUBLISHED',slug:'alpha',symbol:'A',themeIds:['ai','robotics'],
  names:{en:'Alpha','zh-CN':'阿尔法'},aliases:['A'],country:'US',listingStatus:'PUBLIC',listings:[{market:'US',exchange:'NASDAQ',symbol:'A'}],
  description:'Evidence',descriptionTranslations:{},editorialReviewedAt:'2026-10-30',
  inGraph:{status:'PUBLISHED' as const,stageIds:['compute'],stages:[],memberships:[],sources:[],order:1,asOf:'2026-10-30'},
  themeMemberships:{robotics:{status:'PUBLISHED' as const,primarySector:'compute-control',reviewedAt:'2026-10-30',sources:[]}}};
 const stored={...company,updatedAt:new Timestamp(1,0)};
 Object.defineProperty(stored,'searchPrefixes',{enumerable:true,get:()=>{prefixes++;throw Error('Graph expanded search index');}});
 const sdk=withThemeCatalog(new Firestore({projectId:'test-graph-projection'})),db=observeFirestore(sdk,()=>{});
 let authoritative:Record<string,unknown>={...company,name:'Updated Alpha',updatedAt:new Timestamp(2,0)};
 const raw={collection:()=>({doc:(id:string)=>({id})}),getAll:async(...refs:{id:string}[])=>refs.map(ref=>({id:ref.id,exists:true,data:()=>authoritative}))} as unknown as Firestore;
 enableCompanyDirectory(db,raw,{sync:false,file:async()=>{loads++;start();await gate;return new Map([['US:A',stored],['US:B',stored]]);}});
 const pending=Array.from({length:16},()=>withPageEntityReads(()=>loadThemeEnrolledCompanies(db)));
 await started;
 await refreshCompanyDirectoryIds(db,['US:A']);
 release();
 const snapshots=await Promise.all(pending);
 assert.equal(loads,1);assert.equal(prefixes,0);
 const expected={...company,id:'US:A',name:'Updated Alpha'};
 for(const snapshot of snapshots){
  const rows=snapshot.docs.map(doc=>({...doc.data(),id:doc.id} as MarketCompany));
  assert.deepEqual(graphFromMarket(rows,[]),graphFromMarket([expected,{...company,id:'US:B'}],[]));
  assert.deepEqual(themedGraph('robotics',rows),themedGraph('robotics',[expected,{...company,id:'US:B'}]));
  assert.equal(snapshot.docs[0].get('searchPrefixes'),undefined);
 }
 snapshots[0].docs[0].data()!.names.en='Caller mutation';
 assert.equal((await loadThemeEnrolledCompanies(db)).docs[0].get('names.en'),'Alpha');
 authoritative={...company,name:'Latest Alpha',updatedAt:new Timestamp(3,0)};
 await refreshCompanyDirectoryIds(db,['US:A']);
 assert.equal((await loadThemeEnrolledCompanies(db)).docs[0].get('name'),'Latest Alpha');
 authoritative={isDeleted:true,updatedAt:new Timestamp(4,0)};
 await refreshCompanyDirectoryIds(db,['US:A']);
 assert.deepEqual((await loadThemeEnrolledCompanies(db)).docs.map(doc=>doc.id),['US:B']);
 assert.equal(prefixes,0);assert.equal(loads,1);
});
test('theme enrollment observes source membership changes without checkpoint reads',async(t)=>{
 t.after(closeLocalCaches);let push!:(snapshot:unknown)=>void,calls=0;
 const query={where:()=>query,select:()=>{throw Error('Firestore cannot listen to a projected query');},onSnapshot:(next:(snapshot:unknown)=>void)=>{calls++;push=next;next({docs:[{id:'US:A',data:()=>({})}]});return ()=>{};}};
 const db=withThemeCatalog({collection:(name:string)=>{assert.equal(name,'companies');return query;}} as unknown as Firestore);
 assert.equal((await loadThemeEnrolledCompanies(db)).docs.length,1);push({docs:[]});
 assert.equal((await loadThemeEnrolledCompanies(db)).docs.length,0);assert.equal(calls,1);
});
