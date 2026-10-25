import type {Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {ONBOARDING_START,validDay,OnboardingBlocked} from './model';

type Action={date:string;split?:string;value?:number;currency?:string;[key:string]:unknown};
async function actionBody(response:Response){
  const reader=response.body?.getReader();if(!reader)throw Error('Empty corporate action response');
  const chunks:Buffer[]=[];let size=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
    if(size>2*1024*1024){await reader.cancel();throw Error('Corporate action response too large');}chunks.push(Buffer.from(chunk.value));}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
}
export function onboardingActions(value:unknown,type:'split'|'dividend',through:string):Action[]{
  if(!validDay(through)||!Array.isArray(value)||value.length>2000)throw Error('Invalid corporate action response');
  const seen=new Set<string>();
  for(const row of value){
    if(!row||!validDay(row.date)||row.date<ONBOARDING_START||row.date>through||seen.has(row.date))throw Error('Invalid corporate action date');
    seen.add(row.date);
    if(type==='split'){
      if(typeof row.split!=='string'||!/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(row.split))throw Error('Invalid split ratio');
      const [a,b]=row.split.split('/').map(Number);
      if(!Number.isFinite(a/b)||a<=0||b<=0)throw Error('Invalid split ratio');
    }else if(!Number.isFinite(row.value)||row.value<0||typeof row.currency!=='string'||!/^[A-Z]{3}$/.test(row.currency))throw Error('Invalid dividend');
  }
  return [...value].sort((a,b)=>a.date.localeCompare(b.date));
}

/** Uses only existing corporate_actions columns; provider-specific dividend values stay in sourcePayload. */
export async function backfillOnboardingActions(input:{db:Firestore;bucket:Bucket;ticker:string;market:string;providerSymbol:string;through:string;token:string;guard:()=>Promise<void>;fetcher?:typeof fetch;pause?:()=>Promise<void>}){
  if(!input.token)throw new OnboardingBlocked('EODHD credential is unavailable');
  const pause=input.pause??(()=>new Promise<void>(resolve=>setTimeout(resolve,1000))),stamp=new Date().toISOString();
  const actions=new Map<'split'|'dividend',Action[]>();
  for(const type of ['split','dividend'] as const){
    await input.guard();
    const file=input.bucket.file(`eod-history/actions/${input.market}/${encodeURIComponent(input.ticker)}/${ONBOARDING_START}_${input.through}/${type}.json`);
    let raw:unknown;
    try{raw=JSON.parse((await file.download())[0].toString('utf8'));}
    catch(error){
      if(Number((error as {code?:number}).code)!==404)throw Error('Corporate action cache unavailable');
      const url=new URL(`https://eodhd.com/api/${type==='split'?'splits':'div'}/${input.providerSymbol}`);
      url.search=new URLSearchParams({api_token:input.token,fmt:'json',from:ONBOARDING_START,to:input.through}).toString();
      const response=await (input.fetcher??fetch)(url,{redirect:'error',signal:AbortSignal.timeout(30_000)});
      if(!response.ok)throw Error('Corporate action provider unavailable');
      const text=await actionBody(response);
      raw=JSON.parse(text);onboardingActions(raw,type,input.through);
      await input.guard();
      try{await file.save(JSON.stringify(raw),{resumable:false,contentType:'application/json',preconditionOpts:{ifGenerationMatch:0}});}
      catch(error){if(Number((error as {code?:number}).code)!==412)throw error;raw=JSON.parse((await file.download())[0].toString('utf8'));}
    }
    actions.set(type,onboardingActions(raw,type,input.through));
  }
  const prior=await input.db.collection('corporate_actions').where('ticker','==',input.ticker).get(),byId=new Map(prior.docs.map(doc=>[doc.id,doc.data()]));
  const writes:{id:string;data:Record<string,unknown>}[]=[];
  for(const [type,rows] of actions){
    const ids=new Set<string>();
    for(const event of rows){
      const id=`${input.market}_${input.ticker}_${type}_${event.date}`;ids.add(id);
      const old=byId.get(id),split=type==='split'?event.split!.split('/').map(Number):null;
      writes.push({id,data:{schemaVersion:1,instrumentId:`${input.market}_${input.ticker}`,ticker:input.ticker,market:input.market,providerSymbol:input.providerSymbol,
        type,effectiveDate:event.date,exDate:event.date,status:'completed',source:type==='split'?'eodhd-splits':'eodhd-dividends',
        sourceUrl:'https://eodhd.com/financial-apis/api-splits-dividends',providerEventId:`${input.providerSymbol}:${type}:${event.date}`,
        sourcePayload:event,retrievedAt:stamp,updatedAt:stamp,...(!old?.createdAt?{createdAt:stamp}:{}),
        ...(split?{splitNumerator:split[0],splitDenominator:split[1],splitFactor:split[0]/split[1]}:{})}});
    }
    for(const doc of prior.docs){const old=doc.data();if(old.market===input.market&&old.type===type&&old.source===(type==='split'?'eodhd-splits':'eodhd-dividends')
      &&old.status==='completed'&&validDay(old.effectiveDate)&&old.effectiveDate>=ONBOARDING_START&&old.effectiveDate<=input.through&&!ids.has(doc.id))writes.push({id:doc.id,data:{status:'cancelled',updatedAt:stamp,retrievedAt:stamp}});}
  }
  for(let i=0;i<writes.length;i+=5){
    await input.guard();const batch=input.db.batch();
    for(const write of writes.slice(i,i+5))batch.set(input.db.collection('corporate_actions').doc(write.id),write.data,{merge:true});
    await batch.commit();if(i+5<writes.length)await pause();
  }
  return {splits:actions.get('split')!.length,dividends:actions.get('dividend')!.length};
}
