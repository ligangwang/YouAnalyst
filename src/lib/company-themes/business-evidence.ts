import type {Firestore} from 'firebase-admin/firestore';
import {gunzipSync} from 'node:zlib';
import {sha256,sourceIdentity,stableId,type EarningsSource} from '../earnings/model';
import type {ThemedCompany} from './model';

export type BusinessEvidence={url:string;title:string;publishedAt:string;kind:'annual_business'|'earnings';text:string};
export function officialThemeDomains(company:ThemedCompany){
  const domains=company.id.startsWith('US:')?['sec.gov']:['cninfo.com.cn','sse.com.cn','szse.cn'];
  const profile=company.profile as {website?:{url?:string;sourceUrl?:string}}|undefined;
  try{const u=new URL(profile?.website?.url??''),source=new URL(profile?.website?.sourceUrl??'');
    if(u.protocol==='https:'&&source.protocol==='https:'&&!u.username&&!u.password&&/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)&&!/^\d+[.]/.test(u.hostname))domains.push(u.hostname);
  }catch{/* A guessed company domain is never trusted. */}
  return [...new Set(domains)];
}
export function isOfficialBusinessUrl(company:ThemedCompany,value:string){
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||value.length>2048||!officialThemeDomains(company).some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return false;
    if(u.hostname==='sec.gov'||u.hostname.endsWith('.sec.gov')){const cik=String(company.cik);return /^\d{1,10}$/.test(cik)&&Number(cik)>0&&(u.pathname.includes(`/data/${Number(cik)}/`)||u.pathname.includes(`CIK${cik.padStart(10,'0')}.json`)||Number(u.searchParams.get('CIK'))===Number(cik));}
    return true;
  }catch{return false;}
}
// Keep the overview plus passages later in the document, where diversified
// companies describe their products and segments. These are excerpts, not a
// claim that the complete report has been inspected.
export function businessPassages(text:string){
  const scan=text.slice(0,1_000_000).replace(/\r/g,'');
  const pieces=[scan.slice(0,2500)];
  const pattern=/\b(?:business (?:overview|description|segments?)|operating segments?|our (?:products|businesses|segments)|products and services)\b|主营业务|主要业务|业务板块|分部信息|经营分部|产品及服务/gi;
  let match:RegExpExecArray|null;let end=2500;
  while((match=pattern.exec(scan))&&pieces.length<7){if(match.index<end)continue;pieces.push(scan.slice(Math.max(0,match.index-150),match.index+1650));end=match.index+1650;}
  return pieces.map(p=>p.replace(/[\t ]+/g,' ').trim()).filter(Boolean).join('\n[…]\n').slice(0,12_000);
}
export function boundedBusinessEvidence(company:ThemedCompany,items:BusinessEvidence[],now=Date.now()){
  const seen=new Set<string>();let remaining=24_000;
  return items.filter(item=>{
    const day=typeof item?.publishedAt==='string'?item.publishedAt.slice(0,10):'',date=Date.parse(day),age=now-date;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day??'')||!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==day||age<0||age>(item.kind==='annual_business'?550:180)*86400_000||!['annual_business','earnings'].includes(item.kind)||typeof item.text!=='string'||item.text.trim().length<100||typeof item.title!=='string'||!item.title.trim()||!isOfficialBusinessUrl(company,item.url))return false;
    return true;
  }).sort((a,b)=>(a.kind===b.kind?b.publishedAt.localeCompare(a.publishedAt):a.kind==='annual_business'?-1:1)).flatMap(item=>{
    if(seen.has(item.url)||seen.size>=3||remaining<100)return [];seen.add(item.url);
    const text=businessPassages(item.text).slice(0,remaining);remaining-=text.length;
    return [{...item,title:item.title.slice(0,500),text}];
  });
}

/** Optional read-only cache input. Missing/corrupt caches leave official search
 * available; they never trigger fundamentals/earnings jobs or new schema writes. */
export async function loadBusinessEvidence(db:Firestore,company:ThemedCompany,now=Date.now()):Promise<BusinessEvidence[]>{
  const items:BusinessEvidence[]=[];
  try{
    const stored=(await db.collection('company_fundamentals').doc(company.id).get()).data();
    const value=stored?.value,report=value?.report;
    if(company.id.startsWith('US:')&&Number(report?.cik)===Number(company.cik)&&/^\d{10}-\d{2}-\d{6}$/.test(report?.accession??'')&&['10-K','20-F','40-F'].includes(report?.form)&&isOfficialBusinessUrl(company,report?.url)){
      let text=typeof value.excerpt==='string'?value.excerpt:'';
      if(report.form==='10-K'){
        const section=(await db.collection('sec_filing_sections').doc(`${report.accession}_item1`).get()).data();
        if(section&&section.accessionNumber===report.accession&&section.sectionId==='item1'&&typeof section.text==='string')text=section.text;
      }
      items.push({url:report.url,title:`${report.form} business and segments (cached excerpt)`,publishedAt:report.filed,kind:'annual_business',text});
    }
  }catch{/* Optional cache: the single classification call can research it. */}
  try{
    // Single-field query, bounded even before the company has joined earnings
    // maintenance. An incomplete cache page is never treated as latest coverage.
    const page=await db.collection('earnings_sources').where('source.companyId','==',company.id).limit(12).get();
    const captures=page.docs.map(doc=>({...doc.data(),id:doc.id} as Record<string,unknown>)).filter(row=>row.recordType==='capture').sort((a,b)=>String(b.retrievedAt).localeCompare(String(a.retrievedAt))).slice(0,2);
    for(const capture of captures)try{
      const source=capture.source as EarningsSource;
      const issuer=company.id.startsWith('US:')?`sec:${String(company.cik).padStart(10,'0')}`:`cn:${company.id.split(':')[1]}`;
      if(source.companyId!==company.id||source.issuerId!==issuer||!isOfficialBusinessUrl(company,source.url)||sourceIdentity(source)!==capture.sourceId||capture.completeness!=='full'||stableId('earnings_capture',[capture.sourceId,capture.rawSha256,capture.textSha256])!==capture.id)continue;
      const metadata={url:source.url,title:source.title,publishedAt:source.publishedAt?.value??source.filingDate??'',kind:'earnings' as const};
      if(!boundedBusinessEvidence(company,[{...metadata,text:'x'.repeat(100)}],now).length)continue;
      const length=Number(capture.textByteLength),ids=capture.textChunks;
      if(length<100||length>1_000_000||!Array.isArray(ids)||!ids.length||ids.length>3)continue;
      const chunks:Buffer[]=[];
      for(let i=0;i<ids.length;i++){
        if(ids[i]!==`chunk_text_${capture.textSha256}_${i}`)throw Error('Invalid earnings text manifest');
        const chunk=(await db.collection('earnings_sources').doc(ids[i]).get()).data();
        if(chunk?.recordType!=='raw_chunk'||chunk.encoding!=='gzip'||!(chunk.bytes instanceof Uint8Array)||chunk.bytes.length>400_000||sha256(chunk.bytes)!==chunk.chunkSha256)throw Error('Invalid earnings text chunk');
        chunks.push(Buffer.from(chunk.bytes));
      }
      const bytes=gunzipSync(Buffer.concat(chunks),{maxOutputLength:1_000_000});
      if(bytes.length!==length||sha256(bytes)!==capture.textSha256)continue;
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      // Publication date, never retrieval time, determines freshness.
      items.push({...metadata,text});
    }catch{/* Ignore corrupt or unsupported captures; retain official fallback. */}
  }catch{/* No earnings record is required for onboarding. */}
  return boundedBusinessEvidence(company,items,now);
}
