import {randomUUID} from 'node:crypto';
import {FieldPath, type Firestore} from 'firebase-admin/firestore';
import {historyProviderSymbol} from './history-backfill';
import {predictionInstrument,type PredictionMarket} from './instrument';

function validDate(value:unknown):value is string {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}

/** All users, including private lists and legacy saved-company preferences. */
export async function corporateActionTickers(db:Firestore,market:PredictionMarket,mapTickers:string[]){
  const tickers=new Set<string>();
  const add=(value:unknown)=>{
    if(typeof value!=='string'||value.startsWith('ORG:'))return;
    const instrument=predictionInstrument(value.replace(/^US:/,''));
    if(instrument?.market===market)tickers.add(instrument.ticker);
  };
  mapTickers.forEach(add);
  for(const [collection,fields] of [['industry_map_preferences',['followedCompanyIds','tickers']],['predictions',['watchlistId','ticker']]] as const){
    let cursor:string|undefined;
    for(;;){
      let query=db.collection(collection).select(...fields).orderBy(FieldPath.documentId()).limit(500);
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();
      for(const doc of page.docs){
        const data=doc.data();
        if(collection==='predictions'){
          if(typeof data.watchlistId==='string'&&data.watchlistId.trim())add(data.ticker);
        }else{
          if(Array.isArray(data.followedCompanyIds))data.followedCompanyIds.forEach(add);
          if(Array.isArray(data.tickers))data.tickers.forEach(add);
        }
      }
      if(page.docs.length<500)break;
      cursor=page.docs.at(-1)!.id;
    }
  }
  return [...tickers].sort();
}

export function splitHistory(value:unknown,through:string,from?:string){
  if(!Array.isArray(value)||value.length>10000)throw Error('Invalid split response');
  const events=new Map<string,{date:string;split:string;numerator:number;denominator:number}>();
  for(const row of value){
    if(!row||!validDate(row.date)||row.date>through||(from&&row.date<from)||typeof row.split!=='string'||!/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(row.split))throw Error('Invalid split response');
    const [numerator,denominator]=row.split.split('/').map(Number);
    if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||numerator<=0||denominator<=0||!Number.isFinite(numerator/denominator)||numerator/denominator<=0||events.has(row.date))throw Error('Invalid split response');
    events.set(row.date,{date:row.date,split:row.split,numerator,denominator});
  }
  return [...events.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

/** Full history once; checkpoints advance only after every action write succeeds. */
export async function syncCorporateActions(input:{db:Firestore;tickers:string[];through:string;token:string;apiUrl?:string;fetcher?:typeof fetch;now?:()=>number;deadline?:number}){
  const {db,through}=input,now=input.now??Date.now,fetcher=input.fetcher??fetch;
  if(!validDate(through)||!input.token)throw Error('Corporate action configuration unavailable');
  const base=new URL(input.apiUrl||'https://eodhd.com');
  if(base.protocol!=='https:'||!['eodhd.com','www.eodhd.com'].includes(base.hostname)||base.username||base.password)throw Error('Invalid corporate action provider');
  const tickers=[...new Set(input.tickers)].sort();
  const result={requested:tickers.length,backfilled:0,updated:0,skipped:0,deferred:0,events:0,failures:[] as {ticker:string;reason:string}[]};
  const deadline=input.deadline??now()+180_000;
  let next=0;
  async function worker(){
    for(;;){
      const ticker=tickers[next++];if(ticker===undefined)return;
      if(now()>deadline-35_000){result.deferred++;continue;}
      const instrument=predictionInstrument(ticker);
      if(!instrument){result.failures.push({ticker,reason:'Unsupported split symbol'});continue;}
      const stateRef=db.collection('collectors').doc(`split-history_${instrument.market}_${ticker}`),owner=randomUUID();
      try{
        const claim=await db.runTransaction(async tx=>{
          const state=(await tx.get(stateRef)).data();
          if(state?.historyComplete===true&&state.schemaVersion===1&&validDate(state.lastSuccessfulThrough)&&state.lastSuccessfulThrough>=through)return {skip:true as const};
          if(Number(state?.leaseUntil)>now())return {busy:true as const};
          const complete=state?.historyComplete===true&&state.schemaVersion===1&&validDate(state.lastSuccessfulThrough);
          const from=complete?new Date(Date.parse(state.lastSuccessfulThrough)-30*86400000).toISOString().slice(0,10):undefined;
          tx.set(stateRef,{schemaVersion:1,ticker,market:instrument.market,type:'split',status:'running',leaseOwner:owner,leaseUntil:now()+20*60_000,updatedAt:new Date(now()).toISOString()},{merge:true});
          return {from};
        });
        if('skip'in claim){result.skipped++;continue;}
        if('busy'in claim){result.deferred++;continue;}
        const providerSymbol=historyProviderSymbol(ticker);
        const url=new URL(`/api/splits/${providerSymbol}`,base);
        url.search=new URLSearchParams({api_token:input.token,fmt:'json',to:through,...(claim.from?{from:claim.from}:{})}).toString();
        let events:ReturnType<typeof splitHistory>;
        try{
          const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30_000)});
          if(!response.ok)throw Error('Provider request failed');
          events=splitHistory(await response.json(),through,claim.from);
        }catch{throw Error('Corporate action provider unavailable or invalid');}
        const stored=await db.collection('corporate_actions').where('ticker','==',ticker).get();
        const byId=new Map(stored.docs.map(doc=>[doc.id,doc]));
        const seen=new Set(events.map(event=>event.date));
        const writes:{ref:FirebaseFirestore.DocumentReference;data:Record<string,unknown>}[]=[];
        const stamp=new Date(now()).toISOString();
        for(const event of events){
          const id=`${instrument.market}_${ticker}_split_${event.date}`,existing=byId.get(id)?.data();
          // Preserve original creation metadata when refreshing or correcting an event.
          writes.push({ref:db.collection('corporate_actions').doc(id),data:{schemaVersion:1,instrumentId:`${instrument.market}_${ticker}`,ticker,market:instrument.market,
            providerSymbol,type:'split',effectiveDate:event.date,exDate:event.date,status:'completed',splitNumerator:event.numerator,splitDenominator:event.denominator,
            splitFactor:event.numerator/event.denominator,source:'eodhd-splits',sourceUrl:'https://eodhd.com/financial-apis/api-splits-dividends',providerEventId:`${providerSymbol}:split:${event.date}`,
            sourcePayload:{date:event.date,split:event.split},retrievedAt:stamp,updatedAt:stamp,...(!existing?.createdAt?{createdAt:stamp}:{})}});
        }
        // A successful replacement window also reconciles removed/corrected provider dates.
        for(const doc of stored.docs){
          const data=doc.data(),date=data.effectiveDate;
          if(data.market===instrument.market&&data.type==='split'&&data.source==='eodhd-splits'&&validDate(date)&&date<=through&&(!claim.from||date>=claim.from)&&!seen.has(date)&&data.status==='completed'){
            writes.push({ref:doc.ref,data:{status:'cancelled',updatedAt:stamp,retrievedAt:stamp}});
          }
        }
        for(let offset=0;offset<writes.length;offset+=400){
          const batch=db.batch();for(const write of writes.slice(offset,offset+400))batch.set(write.ref,write.data,{merge:true});await batch.commit();
        }
        await db.runTransaction(async tx=>{
          if((await tx.get(stateRef)).data()?.leaseOwner!==owner)throw Error('Split sync lease lost');
          tx.set(stateRef,{historyComplete:true,lastSuccessfulThrough:through,status:'completed',leaseUntil:0,leaseOwner:null,lastError:null,updatedAt:stamp},{merge:true});
        });
        if(claim.from)result.updated++;else result.backfilled++;
        result.events+=events.length;
      }catch{
        result.failures.push({ticker,reason:'Split synchronization failed'});
        await db.runTransaction(async tx=>{
          if((await tx.get(stateRef)).data()?.leaseOwner===owner)tx.set(stateRef,{status:'failed',leaseUntil:0,leaseOwner:null,lastError:'Split synchronization failed',updatedAt:new Date(now()).toISOString()},{merge:true});
        });
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,tickers.length)},worker));
  return result;
}
