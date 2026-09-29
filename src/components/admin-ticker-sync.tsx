"use client";
import {useRef, useState} from "react";
import {useAuth} from "@/components/providers/auth-provider";
import {useLocale} from "./providers/locale-provider";

export function AdminTickerSync({onBusy,onComplete}:{onBusy:(busy:boolean)=>void;onComplete:()=>void}) {
  const {getIdToken}=useAuth(), {text}=useLocale();
  const [country,setCountry]=useState("United States"),[currency,setCurrency]=useState("USD");
  const [types,setTypes]=useState("Common Stock,ETF,American Depositary Receipt,Depositary Receipt"),[limit,setLimit]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState<Record<string,unknown>|null>(null);
  const pending=useRef(false);
  async function run(dryRun:boolean) {
    if(pending.current)return;
    pending.current=true;setBusy(true);onBusy(true);setError("");setResult(null);
    try {
      const token=await getIdToken();if(!token)throw Error(text("Sign in with an admin account.","请使用管理员账户登录。"));
      const response=await fetch("/api/admin/jobs/tickers",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({dryRun,country,currency,types:types.split(",").map(t=>t.trim()).filter(Boolean),...(limit?{limit:Number(limit)}:{})})});
      const data=await response.json();if(!response.ok)throw Error(data.error||"Ticker sync failed");
      setResult(data);
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{pending.current=false;setBusy(false);onBusy(false);onComplete();}
  }
  const input="rounded border border-slate-600 bg-slate-950 p-2";
  return <section className="mb-6 rounded-xl border border-slate-700 p-4">
    <p className="mb-3 text-sm text-slate-300">{text("Preview searchable securities before syncing. Sync updates ticker and company listings; existing research is preserved. Sync runs in the background; you can close the page after it is queued.","同步前可预览可搜索的证券。同步更新股票和公司上市资料，保留已有研究。同步排队后将在后台运行，可以关闭页面。")}</p>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">{text("Country","国家")}<input className={input} value={country} onChange={e=>setCountry(e.target.value)}/></label>
      <label className="grid gap-1">{text("Currency","货币")}<input className={input} value={currency} onChange={e=>setCurrency(e.target.value)}/></label>
      <label className="grid gap-1">{text("Security types (comma-separated)","证券类型（逗号分隔）")}<input className={input} value={types} onChange={e=>setTypes(e.target.value)}/></label>
      <label className="grid gap-1">{text("Limit (blank for all)","数量上限（留空表示全部）")}<input className={input} type="number" min="1" max="50000" value={limit} onChange={e=>setLimit(e.target.value)}/></label>
      <button className={input} onClick={()=>void run(true)}>{text("Preview ticker sync","预览股票目录同步")}</button>
      <button className="rounded bg-cyan-400 p-2 text-slate-950" onClick={()=>void run(false)}>{text("Sync ticker catalog now","立即同步股票目录")}</button>
    </fieldset>
    {busy&&<p role="status">{text("Sync request in progress…","同步请求进行中…")}</p>}
    {error&&<p role="alert" className="mt-3 text-amber-300">{error}</p>}
    {result&&<div role="status" className="mt-3"><p>{result.dryRun?text("Preview complete. No catalog changes written.","预览完成，未写入目录更改。"):text("Ticker sync queued. Processing continues in the background. Refresh run history for results.","股票目录同步已排队，将在后台继续处理。请刷新运行记录查看结果。")}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result,null,2)}</pre></div>}
  </section>;
}
