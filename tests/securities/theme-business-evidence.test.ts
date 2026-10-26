import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import type {Firestore} from 'firebase-admin/firestore';
import {boundedBusinessEvidence,businessPassages,loadBusinessEvidence,type BusinessEvidence} from '../../src/lib/company-themes/business-evidence';
import {sha256,sourceIdentity,stableId,type EarningsSource} from '../../src/lib/earnings/model';

const now=Date.parse('2026-10-26T12:00:00Z'),company={id:'US:TEST',cik:'0000000123'};
const url='https://www.sec.gov/Archives/edgar/data/123/000000012326000001/report.htm';
const annual:BusinessEvidence={url,title:'Annual business report',kind:'annual_business',publishedAt:'2026-02-01',text:'Our products include industrial robots. '.repeat(500)};
function fixture(rows:Record<string,Record<string,unknown>>){
  const reads:string[]=[];
  const db={collection:(name:string)=>({doc:(id:string)=>({get:async()=>{reads.push(`${name}/${id}`);return {data:()=>rows[`${name}/${id}`]};}}),where:(field:string,op:string,value:string)=>({limit:(n:number)=>({get:async()=>{assert.equal(field,'source.companyId');assert.equal(op,'==');assert.equal(n,12);return {docs:Object.entries(rows).filter(([key,row])=>key.startsWith(name+'/')&&(row.source as EarningsSource)?.companyId===value).slice(0,n).map(([key,row])=>({id:key.split('/')[1],data:()=>row}))};}})})})} as unknown as Firestore;
  return {db,reads};
}
function capture(companyId=company.id,issuerId='sec:0000000123',sourceUrl=url,published='2026-10-01'){
  const source:EarningsSource={companyId,issuerId,url:sourceUrl,title:'Official earnings business update',provider:companyId.startsWith('US:')?'sec':'cninfo',documentId:'earnings',publishedAt:{value:published,precision:'date',timezone:null},firstSeenAt:'2026-10-01T00:00:00Z',language:'en'};
  const text='Operating segments: Robotics designs and manufactures robots. '.repeat(10),bytes=Buffer.from(text),hash=sha256(bytes),compressed=gzipSync(bytes),sourceId=sourceIdentity(source),rawSha256=sha256('raw'),id=stableId('earnings_capture',[sourceId,rawSha256,hash]),chunk=`chunk_text_${hash}_0`;
  return {id,chunk,text,rows:{[`earnings_sources/${id}`]:{recordType:'capture',source,sourceId,rawSha256,textSha256:hash,completeness:'full',retrievedAt:'2026-10-01T12:00:00Z',textByteLength:bytes.length,textChunks:[chunk]},[`earnings_sources/${chunk}`]:{recordType:'raw_chunk',encoding:'gzip',bytes:compressed,chunkSha256:sha256(compressed)}}};
}
test('bounded business excerpts include later segment passages and reject stale or wrong-issuer input',()=>{
  assert.match(businessPassages('Overview. '.repeat(1000)+'\nOperating segments\nRobotics produces robots.'),/Robotics produces robots/);
  const items=boundedBusinessEvidence(company,[annual,{...annual,url:url.replace('/123/','/999/')},{...annual,publishedAt:'2020-01-01'},{...annual,publishedAt:'2027-01-01'},{...annual,publishedAt:'2026-02-30'}],now);
  assert.equal(items.length,1);assert(items[0].text.length<=12000);
  assert.equal(boundedBusinessEvidence(company,[{...annual,kind:'earnings',publishedAt:'2026-02-01'}],now).length,0);
  assert.equal(boundedBusinessEvidence(company,[{...annual,url:'https://news.example.com/report'}],now).length,0);
});
test('cached annual section supplements the short fundamentals excerpt without invoking another job',async()=>{
  const f=fixture({'company_fundamentals/US:TEST':{value:{report:{cik:company.cik,accession:'0000000123-26-000001',form:'10-K',filed:'2026-02-01',url},excerpt:'Too short.'}},'sec_filing_sections/0000000123-26-000001_item1':{accessionNumber:'0000000123-26-000001',sectionId:'item1',text:annual.text+'\nOperating segments: Robotics builds robots.'}});
  const evidence=await loadBusinessEvidence(f.db,company,now);assert.equal(evidence.length,1);assert.match(evidence[0].text,/Our products/);assert(f.reads.some(r=>r.startsWith('sec_filing_sections/')));
});
test('verified US and A-share earnings captures provide supplemental business narrative',async()=>{
  for(const row of [capture(),capture('XSHG:600129','cn:600129','https://static.cninfo.com.cn/finalpage/2026-10-01/report.PDF')]){
    const f=fixture(row.rows),id=(row.rows[`earnings_sources/${row.id}`].source as EarningsSource).companyId;
    const evidence=await loadBusinessEvidence(f.db,{...company,id},now);assert.equal(evidence.length,1);assert.equal(evidence[0].kind,'earnings');assert.match(evidence[0].text,/Robotics/);
  }
});
test('missing, corrupt, stale, or foreign-issuer earnings caches safely leave official-search fallback',async()=>{
  const corrupt=capture();corrupt.rows[`earnings_sources/${corrupt.chunk}`].chunkSha256='wrong';
  for(const rows of [{},corrupt.rows,capture(company.id,'sec:0000000999').rows,capture(company.id,'sec:0000000123',url,'2020-01-01').rows,capture(company.id,'sec:0000000123',url.replace('/123/','/999/')).rows])assert.deepEqual(await loadBusinessEvidence(fixture(rows).db,company,now),[]);
  const broken={collection:()=>{throw Error('Cache unavailable');}} as unknown as Firestore;
  assert.deepEqual(await loadBusinessEvidence(broken,company,now),[]);
});
test('evidence has an aggregate size limit and a stale capture is skipped before chunk reads',async()=>{
  const items=boundedBusinessEvidence(company,Array.from({length:5},(_,i)=>({...annual,url:url+`?part=${i}`,text:'Operating segments: Robotics. '.repeat(5000)})),now);
  assert(items.length<=3);assert(items.reduce((n,item)=>n+item.text.length,0)<=24000);
  const stale=capture(company.id,'sec:0000000123',url,'2020-01-01'),f=fixture(stale.rows);
  assert.deepEqual(await loadBusinessEvidence(f.db,company,now),[]);assert(!f.reads.includes(`earnings_sources/${stale.chunk}`));
});
