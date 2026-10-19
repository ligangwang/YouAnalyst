"use client";
import {useState} from 'react';
import {useLocale} from '@/components/providers/locale-provider';
import {useAuth} from '@/components/providers/auth-provider';
type Failure={id:string;batchId?:string;ticker:string;message:string;failedAt:string|null};
export function AdminFundamentalsErrors(){
 const {getIdToken}=useAuth();const {text}=useLocale();const [rows,setRows]=useState<Failure[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function request(row?:Failure){setBusy(true);setMessage('');try{
 const token=await getIdToken();if(!token)throw Error('Admin sign-in required');
 const response=await fetch('/api/admin/fundamentals-errors',{method:row?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(row?{body:JSON.stringify(row.batchId?{batchId:row.batchId}:{ticker:row.ticker})}:{}),cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Error(data.error??'Request failed');
 if(row){setRows(old=>old.filter(item=>item.id!==row.id));setMessage('Manual retry queued. Check job history for its result.');}else {setRows(data.errors);if(!data.errors.length)setMessage('No unresolved failures.');}
 }catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}
 return <section className="mb-6 rounded-xl border border-slate-700 p-4"><h2>{text('SEC fundamentals — needs attention','SEC 财务数据 — 需要处理')}</h2>
 <p>{text('Failed companies and batches wait for your review. Resolve the cause, then rerun. Shows up to 200 records.','失败公司和批次等待管理员处理。请修复原因后重新运行，最多显示 200 条。')}</p>
 <button disabled={busy} onClick={()=>request()}>{text('Load / refresh errors','加载 / 刷新错误')}</button>
 {message&&<p role="status">{message}</p>}
 {rows.map(row=><div key={row.id} className="border-t border-slate-700 py-3"><strong>{row.ticker}</strong> {row.failedAt} <p>{row.message}</p><button disabled={busy} onClick={()=>request(row)}>{text('Rerun','重新运行')}</button></div>)}
 </section>;
}
