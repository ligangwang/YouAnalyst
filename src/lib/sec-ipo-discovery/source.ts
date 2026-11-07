import {secRequest} from '../sec-request';
import {dailyIndexUrl} from './evidence';

export type IpoSource={daily:(day:string)=>Promise<string|null>;mapping:()=>Promise<unknown>;submission:(cik:string)=>Promise<unknown>;cover:(url:string)=>Promise<string>};
async function limitedText(response:Response,max:number,cover=false){
  const reader=response.body?.getReader();if(!reader)throw Error('Empty SEC response');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;const remaining=max-size;if(value.length>remaining){if(!cover)throw Error('SEC response exceeds limit');chunks.push(value.slice(0,remaining));size=max;break;}chunks.push(value);size+=value.length;if(size===max&&cover)break;}}
  finally{await reader.cancel();}
  return Buffer.concat(chunks).toString('utf8');
}
export function createIpoSource(userAgent:string,signal:AbortSignal):IpoSource{
  if(!userAgent.trim())throw Error('SEC_USER_AGENT is required');
  const read=(url:string,max:number,cover=false)=>secRequest(url,{headers:{'user-agent':userAgent,accept:cover?'text/html':'application/json,text/plain'},signal},response=>limitedText(response,max,cover),{job:'sec-ipo-discovery'});
  let mapping:Promise<unknown>|undefined;
  return {
    daily:async day=>{try{return await read(dailyIndexUrl(day),8_000_000);}catch(error){if((error as {code?:unknown}).code===404)return null;throw error;}},
    mapping:()=>mapping??=read('https://www.sec.gov/files/company_tickers_exchange.json',8_000_000).then(JSON.parse),
    submission:cik=>{if(!/^\d{10}$/.test(cik))throw Error('Invalid CIK');return read(`https://data.sec.gov/submissions/CIK${cik}.json`,8_000_000).then(JSON.parse);},
    cover:url=>{if(!/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/[A-Za-z0-9][A-Za-z0-9_.-]*\.html?$/.test(url))throw Error('Invalid prospectus URL');return read(url,256_000,true);},
  };
}
