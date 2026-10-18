"use client";
import {useState} from 'react';
import {useLocale} from './providers/locale-provider';
import {useAuth} from './providers/auth-provider';
type Failure={id:string;ticker:string;message:string;failedAt:string|null};
export function AdminFundamentalsErrors(){
 const {getIdToken}=useAuth();const {text}=useLocale();const [rows,setRows]=useState<Failure[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function request(ticker?:string){setBusy(true);setMessage('');try{
 const token=await getIdToken();if(!token)throw Error('Admin sign-in required');
 const response=await fetch('/api/admin/fundamentals-errors',{method:ticker?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(ticker?{body:JSON.stringify({ticker})}:{}),cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Error(data.error??'Request failed');
 if(ticker){setRows(old=>old.filter(row=>row.ticker!==ticker));setMessage('Manual retry queued. Check job history for its result.');}else {setRows(data.errors);if(!data.errors.length)setMessage('No unresolved failures.');}
 }catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}
 return <section className="mb-6 rounded-xl border border-slate-700 p-4"><h2>{text('SEC fundamentals — needs attention','SEC 财务数据 — 需要处理')}</h2>
 <p>{text('Failed companies will not retry automatically. Review the error, fix its cause, then retry. Shows up to 100 records.','失败公司不会自动重试。请检查错误并修复原因后手动重试，最多显示 100 条。')}</p>
 <button disabled={busy} onClick={()=>request()}>{text('Load / refresh errors','加载 / 刷新错误')}</button>
 {message&&<p role="status">{message}</p>}
 {rows.map(row=><div key={row.id} className="border-t border-slate-700 py-3"><strong>{row.ticker}</strong> {row.failedAt} <p>{row.message}</p><button disabled={busy} onClick={()=>request(row.ticker)}>{text('Retry manually','手动重试')}</button></div>)}
 </section>;
}
