"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from '@/components/providers/auth-provider';
import {useLocale} from '@/components/providers/locale-provider';
import {ONBOARDING_STEPS,COMPANY_STEPS} from '@/lib/instrument-onboarding/progress';
import type {AdminOnboardingItem,AdminOnboardingPage} from '@/lib/instrument-onboarding/admin';
import type {InstrumentRequestersPage,InstrumentRequester} from '@/lib/instrument-onboarding/requesters';
import styles from './admin-instrument-onboarding.module.css';

const time=(value:string|number|null)=>value?new Date(value).toLocaleString():'—';
function AdminRequesters({instrumentId}:{instrumentId:string}){
  const {getIdToken}=useAuth(),{text}=useLocale();
  const [items,setItems]=useState<InstrumentRequester[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const lock=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function load(after?:string){
    if(lock.current)return;lock.current=true;setBusy(true);setError(false);
    try{
      const token=await getIdToken();if(!token)throw Error('Unauthorized');
      const params=new URLSearchParams({instrumentId,...(after?{requesterCursor:after}:{})});
      const response=await fetch('/api/admin/instrument-onboarding?'+params,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!response.ok)throw Error('Unable to load requesters');
      const data:InstrumentRequestersPage=await response.json();
      if(mounted.current){setItems(current=>after?[...current,...data.items.filter(row=>!current.some(item=>item.requestedByUid===row.requestedByUid))]:data.items);setCursor(data.nextCursor);}
    }catch{if(mounted.current)setError(true);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  return <details className={styles.requesterDetails} onToggle={event=>{if(event.currentTarget.open)void load();}}>
    <summary>{text('View all requesters','查看所有请求用户')}</summary>
    {busy&&<p role="status">{text('Loading requesters…','加载请求用户中…')}</p>}
    {error&&<p role="alert">{text('Unable to load requesters.','无法加载请求用户。')} <button onClick={()=>void load()}>{text('Try again','重试')}</button></p>}
    <ul className={styles.requesterList}>{items.map(item=><li key={item.requestedByUid}><code>{item.requestedByUid}</code><time dateTime={item.requestedAt}>{time(item.requestedAt)}</time></li>)}</ul>
    {!busy&&!error&&!items.length&&<p>{text('No requester records yet.','暂无请求用户记录。')}</p>}
    {cursor&&<button disabled={busy} onClick={()=>void load(cursor)}>{text('Load more requesters','加载更多请求用户')}</button>}
  </details>;
}
export function AdminInstrumentOnboardingPage(){
  const {user,loading,getIdToken}=useAuth(),{text}=useLocale();
  const [items,setItems]=useState<AdminOnboardingItem[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[pending,setPending]=useState<string|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const mounted=useRef(true),generation=useRef(0),retryLock=useRef(false);
  const load=useCallback(async(after?:string)=>{
    const version=++generation.current;setBusy(true);setError('');
    try{
      const token=await getIdToken();if(!token)throw Error('Sign in with an admin account.');
      const response=await fetch('/api/admin/instrument-onboarding'+(after?'?'+new URLSearchParams({cursor:after}):''),{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!response.ok)throw Error('Unable to load requests. Check admin access and retry.');
      const data:AdminOnboardingPage=await response.json();
      if(mounted.current&&generation.current===version){setItems(current=>after?[...current,...data.items.filter(row=>!current.some(item=>item.request.instrumentId===row.request.instrumentId))]:data.items);setCursor(data.nextCursor);}
    }catch(error){if(mounted.current&&generation.current===version)setError(error instanceof Error?error.message:'Unable to load requests');}
    finally{if(mounted.current&&generation.current===version)setBusy(false);}
  },[getIdToken]);
  useEffect(()=>{mounted.current=true;if(user&&!loading)void load();return()=>{mounted.current=false;};},[user,loading,load]);
  async function retry(item:AdminOnboardingItem){
    if(retryLock.current||!item.canRetry||!item.step)return;
    retryLock.current=true;setPending(item.request.instrumentId);setMessage('');setError('');
    try{
      const token=await getIdToken();if(!token)throw Error('Sign in with an admin account.');
      const response=await fetch('/api/admin/instrument-onboarding',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({instrumentId:item.request.instrumentId,step:item.step,updatedAt:item.request.updatedAt})});
      if(!response.ok)throw Error(text('Retry was not accepted. Refresh to check current progress or correct the identity.','未接受重试，请刷新检查当前进度或修正标识。'));
      if(mounted.current){setMessage(text('Failed step queued for retry. Completed steps were preserved.','失败步骤已重新排队，已完成步骤保持不变。'));await load();}
    }catch(error){if(mounted.current)setError(error instanceof Error?error.message:'Unable to retry');}
    finally{retryLock.current=false;if(mounted.current)setPending(null);}
  }
  if(!user)return <p role="alert">{text('Sign in with an admin account.','请使用管理员账户登录。')}</p>;
  return <main className={styles.page}>
    <Link href="/admin">← {text('Admin dashboard','管理面板')}</Link>
    <header><div><p className={styles.eyebrow}>{text('SUPPORT OPERATIONS','支持管理')}</p><h1>{text('Instrument Onboarding','证券入驻')}</h1><p>{text('Company readiness is shared. Prices and corporate actions belong to each instrument.','公司就绪状态共享，价格和公司行动按证券分别处理。')}</p></div><button disabled={busy||pending!==null} onClick={()=>void load()}>{text('Refresh','刷新')}</button></header>
    <p>{text('Retry queues only the failed step for the worker. It does not run provider work in this page.','重试仅将失败步骤重新排队，本页面不会执行数据供应商任务。')}</p>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status">{message}</p>}
    {busy&&<p role="status">{text('Loading requests…','加载请求中…')}</p>}
    {!busy&&!error&&!items.length&&<p>{text('No onboarding requests yet.','暂无入驻请求。')}</p>}
    <div className={styles.requests}>{items.map(item=><article key={item.request.instrumentId}>
      <div className={styles.title}><div><h2>{item.listing||item.instrumentName}</h2><p>{item.companyName} · {item.request.companyId}</p><small>{item.request.instrumentId}</small></div><strong className={styles.badge}>{item.request.status}</strong></div>
      <div className={styles.readiness}><span>{text('Company','公司')}: <strong>{item.companyStatus}</strong></span><span>{text('Instrument','证券')}: <strong>{item.instrumentStatus}</strong></span></div>
      <ol className={styles.steps}>{ONBOARDING_STEPS.map(step=><li key={step} data-complete={item.request.steps[step]==='COMPLETE'} aria-current={item.step===step?'step':undefined}><span>{item.request.steps[step]==='COMPLETE'?'✓':'○'} {step}</span><small>{COMPANY_STEPS.includes(step as typeof COMPANY_STEPS[number])?text('Company','公司'):text('Instrument','证券')}</small></li>)}</ol>
      <dl><div><dt>{text('First requester UID','首位请求用户 UID')}</dt><dd>{item.request.requestedByUid}</dd></div><div><dt>{text('First request time','首次请求时间')}</dt><dd>{time(item.request.requestedAt)}</dd></div><div><dt>{text('Updated','更新时间')}</dt><dd>{time(item.request.updatedAt)}</dd></div><div><dt>{text('History through','历史数据截至')}</dt><dd>{item.request.targetThrough}</dd></div><div><dt>{text('Failed attempts','失败次数')}</dt><dd>{item.request.attemptCount}</dd></div><div><dt>{text('Retry eligible after','可重试时间')}</dt><dd>{time(item.request.nextAttemptAt)}</dd></div><div><dt>{text('Worker lease until','工作租约截至')}</dt><dd>{time(item.request.leaseExpiresAt)}</dd></div></dl>
      <AdminRequesters instrumentId={item.request.instrumentId}/>
      {item.request.lastError&&<p className={styles.error}>{item.request.lastError}</p>}
      <button disabled={!item.canRetry||pending!==null||busy} onClick={()=>void retry(item)}>{pending===item.request.instrumentId?text('Queuing…','排队中…'):text('Retry failed step','重试失败步骤')}</button>
    </article>)}</div>
    {cursor&&<button disabled={busy||pending!==null} onClick={()=>void load(cursor)}>{text('Load more','加载更多')}</button>}
  </main>;
}
