// Public metadata validation only; no database imports or writes.
import {readFileSync} from 'node:fs';
import {publisherFetch} from '../src/lib/intelligence/collectors/publisher-http';
import {secDisclosureRows} from '../src/lib/events/disclosures';
async function json(url:string){
  const response=await publisherFetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'YouAnalyst map collector ligang@youanalyst.com',Accept:'application/json'}});
  if(!response.ok){await response.body?.cancel();throw new Error(`SEC metadata HTTP ${response.status}`);}
  const reader=response.body!.getReader(),parts:Uint8Array[]=[];let bytes=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>8*1024*1024)throw new Error('SEC metadata too large');parts.push(chunk.value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(parts).toString());
}
async function main(){
  const companies=JSON.parse(readFileSync(process.argv[2],'utf8')) as {id:string;market:string}[];
  const mapping=await json('https://www.sec.gov/files/company_tickers_exchange.json');
  const tickerIndex=mapping.fields.indexOf('ticker'),cikIndex=mapping.fields.indexOf('cik');
  if(tickerIndex<0||cikIndex<0)throw new Error('SEC ticker mapping changed');
  for(const company of companies.filter(c=>c.market==='US')){
    const matches=mapping.data.filter((r:unknown[])=>String(r[tickerIndex]).toUpperCase().replaceAll('-','.')===company.id.slice(3).replaceAll('-','.'));
    const ciks=[...new Set(matches.map((r:unknown[])=>String(r[cikIndex]).padStart(10,'0')))];
    if(ciks.length!==1||!/^\d{10}$/.test(String(ciks[0]))){console.log(JSON.stringify({companyId:company.id,status:'unresolved'}));process.exitCode=1;continue;}
    await new Promise(resolve=>setTimeout(resolve,1000));
    try{const payload=await json(`https://data.sec.gov/submissions/CIK${ciks[0]}.json`),rows=secDisclosureRows(company.id,String(ciks[0]),payload);console.log(JSON.stringify({companyId:company.id,status:'ok',cik:ciks[0],documents:rows.filter(r=>r.publication_date!>='2026-01-01').length}));}
    catch(error){console.log(JSON.stringify({companyId:company.id,status:'failed',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;break;}
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
