import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS} from '../../src/lib/instrument-onboarding/model';
import {requestInstrumentOnboarding,processInstrumentOnboarding,type OnboardingHandlers} from '../../src/lib/instrument-onboarding/queue';
import {instrumentId} from '../../src/lib/instruments/model';

export function onboardingFixture(initialNow=Date.parse('2026-10-25T12:00:00Z')){
  const rows=new Map<string,Record<string,unknown>>([['companies/US:NEW',{name:'New',status:'DIRECTORY',cik:'123'}],['companies/XSHE:000001',{name:'A-share',status:'DIRECTORY'}]]);
  const ref=(path:string)=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path),collection:(name:string)=>collection(`${path}/${name}`)});
  const snapshot=(path:string)=>({ref:ref(path),id:path.split('/').at(-1),exists:rows.has(path),data:()=>rows.get(path),get:(key:string)=>rows.get(path)?.[key]});
  const collection=(name:string)=>{
    const query={name,field:'',value:undefined as unknown,where:(field:string,_op:string,value:unknown)=>({...query,field,value}),get:async()=>({docs:[...rows.keys()].filter(path=>path.startsWith(name+'/')).map(snapshot)})};
    return {...query,doc:(id:string)=>ref(`${name}/${id}`)};
  };
  const read=async(r:{path?:string;name?:string;field?:string;value?:unknown})=>r.path?snapshot(r.path):{docs:[...rows.keys()].filter(path=>path.startsWith(r.name+'/')&&rows.get(path)?.[r.field!]===r.value).map(snapshot)};
  let tail=Promise.resolve();
  const db={collection,getAll:async(...refs:{path:string}[])=>refs.map(r=>snapshot(r.path)),runTransaction:<T>(work:(tx:unknown)=>Promise<T>)=>{
    const run=tail.then(async()=>{const writes:(()=>void)[]=[];const value=await work({get:read,getAll:async(...refs:{path:string}[])=>refs.map(r=>snapshot(r.path)),
      create:(r:{path:string},data:Record<string,unknown>)=>{assert(!rows.has(r.path));writes.push(()=>rows.set(r.path,data));},
      set:(r:{path:string},data:Record<string,unknown>,options?:{merge?:boolean})=>writes.push(()=>rows.set(r.path,options?.merge?{...rows.get(r.path),...data}:data)),
      update:(r:{path:string},data:Record<string,unknown>)=>writes.push(()=>rows.set(r.path,{...rows.get(r.path),...data})),});writes.forEach(write=>write());return value;});tail=run.then(()=>undefined,()=>undefined);return run;
  }} as unknown as Firestore;
  let now=initialNow;const clock=()=>now,calls:string[]=[];
  const handlers=Object.fromEntries(ONBOARDING_STEPS.map(step=>[step,async()=>{calls.push(step);}])) as unknown as OnboardingHandlers;
  const id=instrumentId('US:NEW');
  const request=(key=id)=>rows.get(`${ONBOARDING_COLLECTION}/${key}`)!;
  const enqueue=(listing='US:NEW')=>requestInstrumentOnboarding(db,instrumentId(listing),'requester-one',listing,clock());
  const process=(custom=handlers,key=id)=>processInstrumentOnboarding(db,key,custom,clock);
  return {db,rows,calls,handlers,clock,id,request,enqueue,process,advance:(ms:number)=>{now+=ms;}};
}

