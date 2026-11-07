import assert from 'node:assert/strict';
import test from 'node:test';
import {ipoFixture} from '../helpers/sec-ipo';
import {confirmsIpoCover,confirmedMappings,parseDailyIndex,resolveProspectuses,dailyIndexUrl,type Filing,type Listing} from '../../src/lib/sec-ipo-discovery/evidence';
import {importConfirmedIpo,IpoIdentityReview} from '../../src/lib/sec-ipo-discovery/import';
import {runSecIpoDiscovery} from '../../src/lib/sec-ipo-discovery/runner';
import {OnboardingCapacityDeferred} from '../../src/lib/instrument-onboarding/capacity-control';

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
test('SEC mappings require matching CIK, symbol and exchange in both sources; collisions are not guessed',()=>{
  assert.deepEqual(confirmedMappings(mapping,submission,listing.cik),[listing]);
  assert.deepEqual(confirmedMappings(mapping,{...submission,exchanges:['NYSE']},listing.cik),[]);
  assert.deepEqual(confirmedMappings({...mapping,data:[...mapping.data,[456,'Other','NEW','Nasdaq']]},submission,listing.cik),[]);
  assert.throws(()=>confirmedMappings(mapping,{...submission,cik:456},listing.cik));
});
test('registration alone, historical IPO text, resale, SPAC units and unmatched cover symbols do not confirm',()=>{
  assert(confirmsIpoCover(cover,listing));
  assert(confirmsIpoCover(cover.replace('our initial','the initial'),listing));
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
