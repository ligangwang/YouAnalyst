"use client";
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {useAuth} from '@/components/providers/auth-provider';
import {useLocale} from '@/components/providers/locale-provider';
import styles from './admin-instrument-onboarding.module.css';

type Result={index:number;status:string;outcome:string;error?:string};
export function AdminOnboardingBatchRequest({onAccepted}:{onAccepted:()=>void}){
  const {getIdToken}=useAuth(),{text}=useLocale(),field=useId();
  const [value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [results,setResults]=useState<{listing:string;status:string;error?:string}[]>([]);
  const lock=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function submit(event:FormEvent){
    event.preventDefault();if(lock.current)return;
    const listings=[...new Set(value.split(/\r?\n/).map(s=>s.trim().toUpperCase()).filter(Boolean))];
    if(!listings.length||listings.length>25||listings.some(s=>! /^(US:[A-Z0-9][A-Z0-9.-]{0,15}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(s))){setError(text('Enter 1–25 US or A-share listings, one per line.','请输入 1–25 个美股或 A 股代码，每行一个。'));return;}
    lock.current=true;setBusy(true);setError('');setResults([]);
    try{
      const token=await getIdToken();if(!token)throw Error(text('Sign in with an admin account.','请使用管理员账户登录。'));
      const items:{listingId:string;instrumentId:string}[]=[];
      for(const listing of listings){
        const response=await fetch('/api/tickers/search?'+new URLSearchParams({scope:'directory',q:listing,limit:'10'}),{cache:'no-store'});
        if(!response.ok)throw Error(text('Unable to look up listings. Try again.','无法查询证券，请重试。'));
        const data=await response.json(),match=(data.items as {id:string;instrumentId?:string}[]|undefined)?.find(item=>item.id===listing);
        if(!match?.instrumentId||!/^INS_[a-f0-9]{32}$/.test(match.instrumentId))throw Error(text('Listing not found: ','未找到证券：')+listing);
        items.push({listingId:listing,instrumentId:match.instrumentId});
      }
      const response=await fetch('/api/admin/instrument-onboarding/requests',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({items})});
      const data=await response.json();
      if(!Array.isArray(data.items))throw Error(text('Unable to submit requests. Check admin access and retry.','无法提交申请，请检查管理员权限后重试。'));
      if(mounted.current){setResults(data.items.map((row:Result)=>({listing:listings[row.index]??'—',status:row.status,error:row.error})));onAccepted();}
    }catch(error){if(mounted.current)setError(error instanceof Error?error.message:text('Unable to submit requests.','无法提交申请。'));}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  return <form className={styles.batchForm} onSubmit={submit}>
    <h2>{text('Request instrument onboarding','申请证券入驻')}</h2>
    <p>{text('Submit up to 25 listings using your admin account. Existing requests share the same onboarding job.','使用当前管理员账户提交最多 25 个证券。已有申请共用同一个入驻任务。')}</p>
    <label htmlFor={field}>{text('Listings (one per line)','证券代码（每行一个）')}</label>
    <textarea id={field} value={value} onChange={event=>setValue(event.target.value)} placeholder={'US:IBM\nXSHE:300274'} maxLength={2000} rows={3} disabled={busy}/>
    <button type="submit" disabled={busy||!value.trim()}>{busy?text('Submitting…','提交中…'):text('Submit onboarding requests','提交入驻申请')}</button>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {!!results.length&&<ul role="status">{results.map((row,index)=><li key={index}><strong>{row.listing}</strong> — {row.status==='SUPPORTED'?text('Supported','已支持'):row.status==='QUEUED'?text('Onboarding Queued','等待入驻'):row.status==='PROCESSING'?text('Onboarding…','入驻中…'):row.status==='BLOCKED'?text('Onboarding Needs Attention','入驻需要处理'):row.status==='DEFERRED'?text('Deferred','已暂缓'):text('Not accepted','未接受')}{row.error?`: ${row.error}`:''}</li>)}</ul>}
  </form>;
}
