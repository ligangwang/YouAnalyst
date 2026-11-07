import {randomUUID} from 'node:crypto';
import {FieldValue,type Firestore} from 'firebase-admin/firestore';
import {requireOnboardingCapacity,OnboardingCapacityDeferred} from '../instrument-onboarding/capacity-control';
import {SEC_IPO_COLLECTION,parseDailyIndex,confirmedMappings,resolveProspectuses,confirmsIpoCover,type Filing} from './evidence';
import {importConfirmedIpo,IpoIdentityReview} from './import';
import type {IpoSource} from './source';
import {validDay} from '../instrument-onboarding/model';

const DAY=86400_000;
const shift=(day:string,days:number)=>new Date(Date.parse(day)+days*DAY).toISOString().slice(0,10);
export async function runSecIpoDiscovery(db:Firestore,source:IpoSource,options:{clock?:()=>number;pause?:(ms:number)=>Promise<void>;capacity?:()=>Promise<void>;deadline?:number}={}){
  const clock=options.clock??Date.now,pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms))),capacity=options.capacity??(()=>requireOnboardingCapacity(db,clock()));
  const start=clock(),deadline=Math.min(options.deadline??start+120_000,start+120_000),leaseOwner=randomUUID();
  const registry=db.collection(SEC_IPO_COLLECTION),stateRef=registry.doc('scan'),counts={observed:0,checked:0,created:0,queued:0,review:0,missingIndexes:0};
  await capacity();
  const state=await db.runTransaction(async tx=>{const saved=await tx.get(stateRef);if((saved.get('leaseExpiresAt')??0)>clock())return null;tx.set(stateRef,{kind:'SCAN',leaseOwner,leaseExpiresAt:start+5*60_000,lastRunAt:new Date(start).toISOString(),lastError:null},{merge:true});return saved.data()??{};});
  if(!state)return {status:'leased',...counts};
  const guard=async()=>{if(clock()>deadline-5000)throw new OnboardingCapacityDeferred('IPO discovery time budget reached');await capacity();const saved=await stateRef.get();if(saved.get('leaseOwner')!==leaseOwner||saved.get('leaseExpiresAt')<=clock())throw new OnboardingCapacityDeferred('IPO discovery lease lost');};
  const at=()=>new Date(clock()).toISOString();
  let lastError:string|null=null;
  try{
    // Latest completed calendar day in New York. Missing/late indexes are revisited.
    const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
    const yesterday=shift(local,-1),floor=shift(yesterday,-30);
    let cursor=typeof state.cursor==='string'&&validDay(state.cursor)&&state.cursor>=floor&&state.cursor<=shift(yesterday,1)?state.cursor:floor;
    const days=[yesterday,shift(yesterday,-1),shift(yesterday,-2),cursor,shift(cursor,1)].filter((day,i,all)=>day<=yesterday&&all.indexOf(day)===i);
    let writes=0;
    for(const day of days){
      await guard();const text=await source.daily(day);if(text===null){counts.missingIndexes++;if(day===cursor){cursor=shift(cursor,1);await stateRef.update({cursor});}continue;}
      const filings=parseDailyIndex(text,day);let complete=true;
      for(const cik of new Set(filings.map(f=>f.cik))){
        await guard();const ref=registry.doc(`candidate_${cik}`),saved=await ref.get(),previous=(saved.get('filings')??[]) as Filing[];
        const fresh=filings.filter(f=>f.cik===cik&&!previous.some(p=>p.accessionNumber===f.accessionNumber));if(!fresh.length)continue;
        if(writes>=30){complete=false;break;}
        const merged=[...previous,...fresh].sort((a,b)=>b.filingDate.localeCompare(a.filingDate)).slice(0,50);
        await ref.set({kind:'CANDIDATE',cik,filings:merged,status:saved.get('status')==='REVIEW'?'REVIEW':'PENDING',firstSeenAt:saved.get('firstSeenAt')??at(),...(saved.get('status')==='REVIEW'?{}:{nextCheckAt:clock()})},{merge:true});
        writes++;counts.observed++;await pause(1000);
      }
      if(complete&&day===cursor){cursor=shift(cursor,1);await stateRef.update({cursor});}
      if(!complete)break;
    }
    const pending=await registry.where('nextCheckAt','<=',clock()).orderBy('nextCheckAt').limit(10).get();
    for(const doc of pending.docs){
      await guard();const candidate=doc.data();if(candidate.kind!=='CANDIDATE'||candidate.status==='REVIEW')continue;
      counts.checked++;const cik=String(candidate.cik),filings=candidate.filings as Filing[];
      try{
      const hasFinal=filings.some(f=>['424B4','424B1'].includes(f.form));
      const submission=hasFinal?await source.submission(cik):null,prospectuses=hasFinal?resolveProspectuses(submission,filings,cik):[];
      let confirmed=false;
      if(prospectuses.length){
        const listings=confirmedMappings(await source.mapping(),submission,cik);
        for(const filing of prospectuses){
          await guard();const html=await source.cover(filing.sourceUrl);
          for(const listing of listings){
            if(!confirmsIpoCover(html,listing))continue;
            if(counts.created>=5||counts.queued>=5)throw new OnboardingCapacityDeferred('IPO listing admission limit reached');
            await guard();
            try{const result=await importConfirmedIpo(db,listing,[filing],clock());counts.created+=Number(result.created);counts.queued+=Number(result.queued);confirmed=true;}
            catch(error){if(!(error instanceof IpoIdentityReview))throw error;await doc.ref.update({status:'REVIEW',lastError:error.message,lastCheckedAt:at(),nextCheckAt:FieldValue.delete()});counts.review++;confirmed=true;break;}
            await pause(1000);
          }
          if(confirmed)break;
        }
      }
      const current=await doc.ref.get();
      const newest=Math.max(...filings.map(f=>Date.parse(f.filingDate)));
      const retryDelay=!hasFinal?7*DAY:newest<start-30*DAY?30*DAY:DAY;
      if(current.get('status')!=='REVIEW')await doc.ref.update({status:confirmed?'CONFIRMED':'PENDING',lastCheckedAt:at(),lastError:null,nextCheckAt:confirmed?FieldValue.delete():clock()+retryDelay});
      await pause(1000);
      }catch(error){
        if(error instanceof OnboardingCapacityDeferred)throw error;
        // Retain the evidence and defer this issuer so one bad provider response
        // cannot indefinitely starve all other pending candidates.
        await guard();await doc.ref.update({lastCheckedAt:at(),lastError:'SEC verification failed; retry required',nextCheckAt:clock()+60*60_000});
        throw error;
      }
    }
    return {status:'complete',...counts};
  }catch(error){lastError=error instanceof OnboardingCapacityDeferred?error.message:'IPO discovery failed; inspect job diagnostics';throw error;}
  finally{
    await db.runTransaction(async tx=>{const saved=await tx.get(stateRef);if(saved.get('leaseOwner')===leaseOwner)tx.update(stateRef,{leaseOwner:null,leaseExpiresAt:0,lastError,counts});});
  }
}
