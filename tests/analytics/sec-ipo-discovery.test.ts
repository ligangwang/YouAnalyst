import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {ipoFixture} from '../helpers/sec-ipo';
import {confirmsIpoCover,confirmedMappings,parseDailyIndex,resolveProspectuses,dailyIndexUrl,type Filing,type Listing} from '../../src/lib/sec-ipo-discovery/evidence';
import {importConfirmedIpo,IpoIdentityReview} from '../../src/lib/sec-ipo-discovery/import';
import {runSecIpoDiscovery} from '../../src/lib/sec-ipo-discovery/runner';
import {OnboardingCapacityDeferred} from '../../src/lib/instrument-onboarding/capacity-control';
import {inspectIpoDiscovery} from '../../src/lib/sec-ipo-discovery/inspect';

const listing:Listing={cik:'0000000123',symbol:'NEW',exchangeMic:'XNAS',name:'New Issuer'};
const filing:Filing={cik:listing.cik,form:'424B4',accessionNumber:'0001193125-26-123456',filingDate:'2026-11-06',primaryDocument:'ipo.htm',sourceUrl:'https://www.sec.gov/Archives/edgar/data/123/000119312526123456/ipo.htm'};
const header='CIK|Company Name|Form Type|Date Filed|Filename\n';
const index=header+'123|New Issuer|424B4|2026-11-06|edgar/data/123/0001193125-26-123456.txt\n';
const cover='This is our initial public offering of common stock. Our common stock has been approved for listing on the Nasdaq Global Market under the symbol “NEW.”';
const mapping={fields:['cik','name','ticker','exchange'],data:[[123,'New Issuer','NEW','Nasdaq']]};
const submission={cik:123,name:'New Issuer',tickers:['NEW'],exchanges:['Nasdaq'],filings:{recent:{accessionNumber:[filing.accessionNumber],form:['424B4'],filingDate:[filing.filingDate],primaryDocument:['ipo.htm']}}};

test('daily index validates issuer folder and date while permitting filing-agent accession prefixes',()=>{
  assert.equal(parseDailyIndex(index,'2026-11-06')[0].cik,listing.cik);
  assert.throws(()=>parseDailyIndex(index.replace('data/123/','data/456/'),'2026-11-06'));
  assert.throws(()=>parseDailyIndex(index,'2026-11-05'));
  assert.throws(()=>parseDailyIndex('SEC outage','2026-11-06'));
  assert.equal(dailyIndexUrl('2026-11-06'),'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/master.20261106.idx');
});
test('actual SEC daily index header and compact dates are normalized to submissions ISO dates',()=>{
  const text=readFileSync(new URL('../fixtures/sec-ipo-daily-index-20261106.idx',import.meta.url),'utf8');
  const rows=parseDailyIndex(text,'2026-11-06');assert.equal(rows.length,4);
  assert.equal(rows.filter(row=>row.filingDate==='2026-11-06').length,3);
  assert.equal(rows.find(row=>row.cik==='0000777917')?.filingDate,'2026-05-11');
  assert.equal(rows.find(row=>row.form==='424B4')?.cik,'0001826011');
  assert.throws(()=>parseDailyIndex(text,'2026-11-05'),/Invalid IPO index identity/);
});
test('SEC mappings require matching CIK, symbol and exchange in both sources; collisions are not guessed',()=>{
  assert.deepEqual(confirmedMappings(mapping,submission,listing.cik),[listing]);
  assert.deepEqual(confirmedMappings(mapping,{...submission,exchanges:['NYSE']},listing.cik),[]);
  assert.deepEqual(confirmedMappings({...mapping,data:[...mapping.data,[456,'Other','NEW','Nasdaq']]},submission,listing.cik),[]);
  assert.throws(()=>confirmedMappings(mapping,{...submission,cik:456},listing.cik));
});
test('registration alone, historical IPO text, resale, SPAC units and unmatched cover symbols do not confirm',()=>{
  assert(confirmsIpoCover(cover,listing));
  assert(confirmsIpoCover(cover.replace('our initial','the initial'),listing));
  for(const [open,close] of [['&#147;','&#148;'],['&#8220;','&#8221;'],['&#x201c;','&#x201d;'],['&ldquo;','&rdquo;']])assert(confirmsIpoCover(cover.replace('“',open).replace('”',close),listing));
  assert(!confirmsIpoCover(cover.replace('NEW.','NEW.B'),listing));
  assert(!confirmsIpoCover(cover+' We are a blank-check company.',listing));
  for(const text of [cover.replace('This is our initial public offering','We completed our initial public offering in 2020'),cover.replace('approved for listing','applied for listing'),cover.replace('NEW.','OTHER.'),cover+' We are a blank check company.',cover.replace('This is our initial public offering','This prospectus relates to the resale')])assert(!confirmsIpoCover(text,listing),text);
  assert.deepEqual(resolveProspectuses(submission,[{...filing,form:'S-1'}],listing.cik),[]);
  assert.equal(resolveProspectuses(submission,[filing],listing.cik)[0].sourceUrl,filing.sourceUrl);
  assert.throws(()=>resolveProspectuses({...submission,cik:456},[filing],listing.cik));
  assert.deepEqual(resolveProspectuses({...submission,filings:{recent:{accessionNumber:[filing.accessionNumber,'0001193125-26-123457'],form:['424B4','RW'],filingDate:[filing.filingDate,'2026-11-07'],primaryDocument:['ipo.htm','rw.htm']}}},[filing],listing.cik),[]);
});
test('atomic import deduplicates concurrent deliveries and preserves a real-user request',async()=>{
  const f=ipoFixture();const results=await Promise.all([importConfirmedIpo(f.db,listing,[filing]),importConfirmedIpo(f.db,listing,[filing])]);
  assert.equal(results.filter(r=>r.created).length,1);assert.equal(results.filter(r=>r.queued).length,1);
  const requests=[...f.rows].filter(([path])=>path.startsWith('instrument_onboarding_requests/'));
  assert.equal(requests.length,1);assert.equal(requests[0][1].requestedByUid,null);assert.equal(requests[0][1].requestSource,'SEC_IPO');
  const count=f.writes();requests[0][1].requestedByUid='real-user';delete requests[0][1].requestSource;
  await importConfirmedIpo(f.db,listing,[filing]);assert.equal(f.writes(),count);assert.equal(requests[0][1].requestedByUid,'real-user');
  assert(![...f.rows.keys()].some(path=>path.includes('/requesters/')));
});
test('same CIK gets one issuer and distinct listing instruments without replacing editorial data',async()=>{
  const f=ipoFixture();f.rows.set('companies/ORG:existing',{cik:'000123',name:'Editorial Name',status:'PUBLISHED'});
  const a=await importConfirmedIpo(f.db,listing,[filing]);
  const b=await importConfirmedIpo(f.db,{...listing,symbol:'NEWB'},[filing]);
  assert.equal(a.companyId,'ORG:existing');assert.equal(a.companyId,b.companyId);assert.notEqual(a.instrumentId,b.instrumentId);
  assert.equal(f.rows.get('companies/ORG:existing')?.name,'Editorial Name');assert.equal(f.rows.get('companies/US:NEW')?.supersededByCompanyId,'ORG:existing');
});
test('alternate dot/dash listing notation is reviewed rather than creating a duplicate instrument',async()=>{
  const f=ipoFixture();f.rows.set('companies/US:NEW-B',{cik:'123',name:'Existing class',status:'DIRECTORY',symbol:'NEW-B'});
  await assert.rejects(importConfirmedIpo(f.db,{...listing,symbol:'NEW.B'},[filing]),IpoIdentityReview);assert.equal(f.writes(),0);
});
test('orphaned legacy identities cannot be rebound to a reused ticker and another CIK',async()=>{
  for(const sameCik of [false,true]){
    const f=ipoFixture();await importConfirmedIpo(f.db,listing,[filing]);f.rows.delete('companies/US:NEW');
    const before=f.writes(),cik=sameCik?listing.cik:'0000000456';
    await assert.rejects(importConfirmedIpo(f.db,{...listing,cik},[{...filing,cik,sourceUrl:filing.sourceUrl.replace('/123/','/'+Number(cik)+'/')}]),IpoIdentityReview);
    assert.equal(f.writes(),before);assert(!f.rows.has('companies/US:NEW'));
  }
});
test('ticker reuse, ambiguous issuers, private and deleted entities require review without partial writes',async()=>{
  for(const seed of [new Map([['companies/US:NEW',{cik:'456',name:'Old',status:'DIRECTORY'}]]),new Map([['companies/US:A',{cik:'123',name:'A',status:'DIRECTORY'}],['companies/US:B',{cik:123,name:'B',status:'PUBLISHED'}]]),new Map([['companies/US:NEW',{cik:'123',name:'Deleted',status:'DIRECTORY',isDeleted:true}]]),new Map([['companies/US:NEW',{cik:'123',name:'Private',status:'DIRECTORY',listingStatus:'PRIVATE'}]])]){
    const f=ipoFixture();seed.forEach((value,key)=>f.rows.set(key,value));await assert.rejects(importConfirmedIpo(f.db,listing,[filing]),IpoIdentityReview);assert.equal(f.writes(),0);
  }
});
test('runner checks capacity before writes, resumes idempotently and confirms only corroborated prospectuses',async()=>{
  const f=ipoFixture(),now=Date.parse('2026-11-07T16:00:00Z'),source={daily:async(day:string)=>day==='2026-11-06'?index:header,mapping:async()=>mapping,submission:async()=>submission,cover:async()=>cover};
  await assert.rejects(runSecIpoDiscovery(f.db,source,{clock:()=>now,capacity:async()=>{throw new OnboardingCapacityDeferred('paused');}}),OnboardingCapacityDeferred);assert.equal(f.writes(),0);
  const options={clock:()=>now,capacity:async()=>{},pause:async()=>{}};
  assert.equal((await runSecIpoDiscovery(f.db,source,options)).created,1);
  assert.equal((await runSecIpoDiscovery(f.db,source,options)).created,0);
  assert.equal(f.rows.get('sec_ipo_discovery/candidate_0000000123')?.status,'CONFIRMED');
});
test('registration stays pending and failed provider runs release the lease without advancing the failed day',async()=>{
  const f=ipoFixture(),now=Date.parse('2026-11-07T16:00:00Z'),options={clock:()=>now,capacity:async()=>{},pause:async()=>{}};
  const source={daily:async(day:string)=>day==='2026-11-06'?index.replace('424B4','S-1'):header,mapping:async()=>mapping,submission:async()=>submission,cover:async()=>cover};
  assert.equal((await runSecIpoDiscovery(f.db,source,options)).created,0);assert.equal(f.rows.get('sec_ipo_discovery/candidate_0000000123')?.status,'PENDING');
  assert.equal(f.rows.get('sec_ipo_discovery/candidate_0000000123')?.nextCheckAt,now+7*86400000);
  const cursor=f.rows.get('sec_ipo_discovery/scan')?.cursor;
  await assert.rejects(runSecIpoDiscovery(f.db,{...source,daily:async()=>{throw Error('SEC unavailable');}},options));
  assert.equal(f.rows.get('sec_ipo_discovery/scan')?.cursor,cursor);assert.equal(f.rows.get('sec_ipo_discovery/scan')?.leaseOwner,null);
});

test('overlapping discovery runs respect the lease and a capacity pause stops admission before company writes',async()=>{
  const f=ipoFixture(),now=Date.parse('2026-11-07T16:00:00Z');let paused=false;
  const source={daily:async(day:string)=>day==='2026-11-06'?index:header,mapping:async()=>mapping,submission:async()=>submission,cover:async()=>{paused=true;return cover;}};
  const options={clock:()=>now,pause:async()=>{},capacity:async()=>{if(paused)throw new OnboardingCapacityDeferred('paused');}};
  f.rows.set('sec_ipo_discovery/scan',{leaseOwner:'other',leaseExpiresAt:now+1000});
  assert.equal((await runSecIpoDiscovery(f.db,source,options)).status,'leased');assert.equal(f.writes(),0);
  f.rows.clear();await assert.rejects(runSecIpoDiscovery(f.db,source,options),OnboardingCapacityDeferred);
  assert(![...f.rows.keys()].some(key=>key.startsWith('companies/')||key.startsWith('instruments/')));
});

test('provider rollout inspection validates evidence without using an importer or discovery store',async()=>{
  const source={daily:async(day:string)=>day==='2026-11-06'?index:header,mapping:async()=>mapping,submission:async()=>submission,cover:async()=>cover};
  const result=await inspectIpoDiscovery(source,new Date('2026-11-07T16:00:00Z'));
  assert.equal(result.indexes,3);assert.equal(result.checked,1);assert.equal(result.confirmed[0].symbol,'NEW');
});

test('caught-up checkpoint waits for tomorrow instead of restarting the initial backfill',async()=>{
  const f=ipoFixture(),days:string[]=[];f.rows.set('sec_ipo_discovery/scan',{cursor:'2026-11-07'});
  const source={daily:async(day:string)=>{days.push(day);return header;},mapping:async()=>mapping,submission:async()=>submission,cover:async()=>cover};
  await runSecIpoDiscovery(f.db,source,{clock:()=>Date.parse('2026-11-07T16:00:00Z'),capacity:async()=>{},pause:async()=>{}});
  assert.deepEqual(days,['2026-11-06','2026-11-05','2026-11-04']);assert.equal(f.rows.get('sec_ipo_discovery/scan')?.cursor,'2026-11-07');
});
test('historical filing replays in a current daily index do not create fresh IPO candidates',async()=>{
  const f=ipoFixture(),now=Date.parse('2026-11-07T16:00:00Z');
  const old=header+'777917|PRUCO LIFE INSURANCE CO|S-1/A|20260511|edgar/data/777917/0000777917-26-000076.txt\n';
  const source={daily:async(day:string)=>day==='2026-11-06'?old:header,mapping:async()=>mapping,submission:async()=>submission,cover:async()=>cover};
  assert.equal((await runSecIpoDiscovery(f.db,source,{clock:()=>now,capacity:async()=>{},pause:async()=>{}})).observed,0);
  assert(!f.rows.has('sec_ipo_discovery/candidate_0000777917'));
});

test('a large confirmed batch stops at five admissions and retains the rest for later runs',async()=>{
  const f=ipoFixture(),now=Date.parse('2026-11-07T16:00:00Z');
  const entries=Array.from({length:6},(_,i)=>({cik:String(123+i),symbol:`NEW${i}`}));
  const many=header+entries.map(e=>`${e.cik}|Issuer|424B4|2026-11-06|edgar/data/${e.cik}/${filing.accessionNumber}.txt`).join('\n');
  const source={daily:async(day:string)=>day==='2026-11-06'?many:header,mapping:async()=>({...mapping,data:entries.map(e=>[Number(e.cik),'Issuer',e.symbol,'Nasdaq'])}),submission:async(cik:string)=>({...submission,cik:Number(cik),tickers:[entries.find(e=>Number(e.cik)===Number(cik))!.symbol]}),cover:async(url:string)=>cover.replace('NEW.',entries.find(e=>url.includes(`/data/${e.cik}/`))!.symbol+'.')};
  await assert.rejects(runSecIpoDiscovery(f.db,source,{clock:()=>now,capacity:async()=>{},pause:async()=>{}}),OnboardingCapacityDeferred);
  assert.equal([...f.rows.keys()].filter(key=>key.startsWith('instrument_onboarding_requests/')).length,5);
  assert.equal(f.rows.get('sec_ipo_discovery/candidate_0000000128')?.status,'PENDING');
  assert.equal((await runSecIpoDiscovery(f.db,source,{clock:()=>now,capacity:async()=>{},pause:async()=>{}})).created,1);
});

function multipleListingsSource(includeSecond:()=>boolean=()=>true){
  const accession='0001193125-26-123457';
  return {
    daily:async(day:string)=>day==='2026-11-06'?index:day==='2026-11-05'?header+`123|New Issuer|424B4|2026-11-05|edgar/data/123/${accession}.txt\n`:header,
    mapping:async()=>({...mapping,data:includeSecond()?[...mapping.data,[123,'New Issuer','NEWB','Nasdaq']]:mapping.data}),
    submission:async()=>({...submission,tickers:includeSecond()?['NEW','NEWB']:['NEW'],exchanges:includeSecond()?['Nasdaq','Nasdaq']:['Nasdaq'],filings:{recent:{accessionNumber:[filing.accessionNumber,accession],form:['424B4','424B4'],filingDate:['2026-11-06','2026-11-05'],primaryDocument:['ipo.htm','ipo-b.htm']}}}),
    cover:async(url:string)=>url.endsWith('ipo-b.htm')?cover.replace('NEW.','NEWB.'):cover,
  };
}
test('one issuer can admit listings confirmed by separate prospectuses in the same run',async()=>{
  const f=ipoFixture();const result=await runSecIpoDiscovery(f.db,multipleListingsSource(),{clock:()=>Date.parse('2026-11-07T16:00:00Z'),capacity:async()=>{},pause:async()=>{}});
  assert.equal(result.created,2);assert.equal(result.queued,2);
  assert.equal(f.rows.get('companies/US:NEWB')?.supersededByCompanyId,'US:NEW');
  assert.equal([...f.rows.keys()].filter(key=>key.startsWith('instrument_onboarding_requests/')).length,2);
});
test('recent confirmed issuers are rechecked for delayed SEC listing metadata without duplicating existing work',async()=>{
  const f=ipoFixture();let now=Date.parse('2026-11-07T16:00:00Z'),second=false;
  const source=multipleListingsSource(()=>second),options={clock:()=>now,capacity:async()=>{},pause:async()=>{}};
  assert.equal((await runSecIpoDiscovery(f.db,source,options)).created,1);
  assert.equal(f.rows.get('sec_ipo_discovery/candidate_0000000123')?.nextCheckAt,now+86400000);
  const [firstPath,first]=[...f.rows.entries()].find(([,row])=>row.instrumentId&&row.requestSource==='SEC_IPO')!;
  const requestedAt=first.requestedAt;now+=86400001;second=true;
  const result=await runSecIpoDiscovery(f.db,source,options);assert.equal(result.created,1);assert.equal(result.queued,1);
  assert.equal(f.rows.get(firstPath)?.requestedAt,requestedAt);assert.equal([...f.rows.keys()].filter(key=>key.startsWith('instrument_onboarding_requests/')).length,2);
  now+=8*86400000;assert.equal((await runSecIpoDiscovery(f.db,source,options)).created,0);
  assert.equal(f.rows.get('sec_ipo_discovery/candidate_0000000123')?.nextCheckAt,undefined);
});
