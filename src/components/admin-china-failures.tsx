"use client";
import {useState} from 'react';
import {useAuth} from '@/components/providers/auth-provider';
import {useLocale} from '@/components/providers/locale-provider';

type Failure={id:string;companyId:string;kind:'fundamentals'|'announcements'|'earnings-fallback';message:string;failedAt:string|null};
export function AdminChinaFailures(){
  const {getIdToken}=useAuth(),{text}=useLocale();
  const [rows,setRows]=useState<Failure[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function request(row?:Failure){
    setBusy(true);setMessage('');
    try{
      const token=await getIdToken();if(!token)throw Error(text('Admin sign-in required','需要管理员登录'));
      const response=await fetch('/api/admin/china-failures',{method:row?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(row?{body:JSON.stringify({id:row.id,kind:row.kind})}:{}),cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.error??'Request failed');
      if(row)setMessage(text('Rerun queued. Refresh to check its result.','已排队重新运行，请刷新以查看结果。'));
      else {setRows(data.errors);if(!data.errors.length)setMessage(text('No failed China tasks need attention.','没有需要处理的中国任务失败记录。'));}
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  }
  return <section className="mb-6 rounded-xl border border-slate-700 p-4" aria-labelledby="china-failures-heading">
    <h2 id="china-failures-heading">{text('China failures — needs attention','中国任务 — 需要处理')}</h2>
    <p>{text('Failed tasks wait for your review. Resolve the cause, then rerun.','失败任务等待管理员处理。请解决原因后重新运行。')}</p>
    <button className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40" disabled={busy} onClick={()=>request()}>{text('Load / refresh failures','加载 / 刷新失败记录')}</button>
    {message&&<p role="status">{message}</p>}
    {rows.map(row=><div key={`${row.kind}:${row.id}`} className="border-t border-slate-700 py-3"><strong>{row.companyId}</strong> · {row.kind} {row.failedAt&&new Date(row.failedAt).toLocaleString()}<p>{row.message}</p><button className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40" disabled={busy} onClick={()=>request(row)}>{text('Rerun','重新运行')}</button></div>)}
  </section>;
}
