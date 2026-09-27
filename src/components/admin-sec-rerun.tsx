"use client";
import {useRef,useState} from "react";
import {useAuth} from "@/components/providers/auth-provider";
import {useLocale} from "./providers/locale-provider";

const jobs = {
  privateValuations: { endpoint: "/api/admin/jobs/private-valuations",
    description: ["Check official sources for private companies in the graph. Verify reviewed valuations and find funding announcements to review. Valuations older than one year are flagged. Results and source links appear in run logs.","检查图谱中私人公司的官方来源，验证已审核估值并查找待审核融资公告。标记超过一年的估值。结果和来源链接见运行日志。"],
    button: ["Run private valuation check now","立即检查私人公司估值"] },
  fundamentals: { endpoint: "/api/admin/jobs/sec",
    description: ["Refresh queued SEC fundamentals and recalculate market caps from the latest stored EOD prices. Fresh SEC data and provider cooldowns are respected. No trading date is needed.","刷新排队中的 SEC 财务数据，并使用最新已存储收盘价重新计算市值。保留新鲜缓存并遵守数据源冷却时间，无需选择交易日期。"],
    button: ["Run SEC fundamentals now","立即运行 SEC 财务任务"] },
  cnFundamentals: { endpoint: "/api/admin/jobs/cn-fundamentals",
    description: ["Refresh annual revenue and net income attributable to the parent through AKShare for all Shanghai and Shenzhen A-share companies on the published map, including newly added companies. Also check corporate actions, refresh share counts, and recalculate market caps from stored China EOD prices. Fresh caches and provider cooldowns are respected; failed requests keep existing data, and deferred companies resume on a later run. No trading date is needed.","通过 AKShare 刷新已发布图谱中所有沪深 A 股公司的年度营收和归母净利润，自动包含新加入的公司。同时检查股本变动、刷新股本并使用已存储收盘价重算市值。保留新鲜缓存并遵守数据源冷却时间；获取失败保留旧数据，未完成公司在后续运行继续处理。无需选择交易日期。"],
    button: ["Run A-share fundamentals now","立即运行 A 股财务与市值任务"] },
} as const;

export function AdminSecRerun({onBusy,onComplete,job="fundamentals"}:{onBusy:(busy:boolean)=>void;onComplete:()=>void;job?:keyof typeof jobs}) {
  const {getIdToken}=useAuth(); const {text}=useLocale();
  const config=jobs[job];
  const pending=useRef(false); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [failed,setFailed]=useState(false);
  async function run() {
    if(pending.current)return;pending.current=true;setBusy(true);onBusy(true);setMessage("");setFailed(false);
    try {
      const token=await getIdToken();if(!token)throw Error(text("Sign in with an admin account.","请使用管理员账户登录。"));
      const response=await fetch(config.endpoint,{method:"POST",headers:{Authorization:`Bearer ${token}`}});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      setMessage(text("Run requested. It continues in the background. Refresh history to see its status and results.","已请求运行。任务将在后台继续，请刷新记录以查看状态和结果。"));
    }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:String(error));}
    finally{pending.current=false;setBusy(false);onBusy(false);onComplete();}
  }
  return <section className="mb-6 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
    <p className="mb-3 text-sm text-slate-400">{text(config.description[0],config.description[1])}</p>
    <button onClick={run} disabled={busy} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{busy?text("Requesting run…","正在请求运行…"):text(config.button[0],config.button[1])}</button>
    {message&&<p role={failed?"alert":"status"} className={`mt-3 text-sm ${failed?"text-amber-300":"text-emerald-300"}`}>{message}</p>}
  </section>;
}
