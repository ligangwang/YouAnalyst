"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "@/components/providers/locale-provider";
import { AdminTickerSync } from "./admin-ticker-sync";
import { AdminEodRerun } from "./admin-eod-rerun";
import { AdminSecRerun } from "./admin-sec-rerun";
import { scheduledJobs, type JobId, type HistoryView, type JobHistoryPage, type JobRecord } from "@/lib/admin-jobs/model";
import type { GraphBudgetSummary } from "@/lib/company-graph/budget";

const button = "rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40";
const chineseNames: Record<JobId, string> = { companyGraph: "公司关系图请求", companyGraphBatches: "公司关系图处理", secFilings: "SEC 文件发现", cnFundamentalsChecks: "A 股财务检查", directoryImports: "中国目录导入", tickers: "股票目录", privateValuations: "私人公司估值", privateValuationChecks: "私人公司估值检查", fundamentals: "SEC 财务数据", fundamentalsBatches: "SEC 财务批次", cnFundamentals: "A 股财务与市值", directory: "中国公司目录", us: "美国收盘维护", china: "中国收盘维护" };
const chineseSchedules: Partial<Record<JobId, string>> = {
  secFilings: "每 15 分钟一次；部署初期暂停调度并禁用采集",
  companyGraph: "每 5 分钟发布 1–5 个请求；部署初期暂停调度",
  companyGraphBatches: "处理排队请求和文件事件；部署初期禁用处理",
};
const statusLabels: Record<string, string> = { Succeeded: "成功", Failed: "失败", Cancelled: "已取消", Starting: "启动中", Running: "运行中", Unknown: "未知", "No completion recorded": "无完成记录", "Completed with errors": "完成但有错误", "Delivery started": "开始触发", "Delivery failed": "触发失败", Delivered: "已送达" };
function date(value: string) { return value ? new Date(value).toLocaleString() : "—"; }
function summary(record: JobRecord): string {
  const fields = record.summary;
  const counts = ["requested", "completed", "processed", "failed", "remaining", "companies", "count", "created", "updated", "unchanged", "attemptedWrites", "written", "discovered", "published", "scanned"]
    .filter(key => typeof fields[key] === "number").map(key => `${key}: ${fields[key]}`);
  if (fields.priceLoad) counts.push(`prices: ${JSON.stringify(fields.priceLoad)}`);
  if (fields.fx) counts.push(`FX: ${JSON.stringify(fields.fx)}`);
  if (fields.marketCaps) counts.push(`market caps: ${JSON.stringify(fields.marketCaps)}`);
  if (fields.shares) counts.push(`shares: ${JSON.stringify(fields.shares)}`);
  if (fields.annual) counts.push(`annual financials: ${JSON.stringify(fields.annual)}`);
  if (fields.actions) counts.push(`corporate actions: ${JSON.stringify(fields.actions)}`);
  if (fields.coverage) counts.push(`coverage: ${JSON.stringify(fields.coverage)}`);
  return counts.join(" · ") || record.message || String((fields.error as { message?: string } | undefined)?.message ?? "");
}

function graphBudgetMoney(value: number) {
  return `US$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function AdminGraphBudget() {
  const { user, loading, getIdToken } = useAuth();
  const { text } = useLocale();
  const [budget, setBudget] = useState<GraphBudgetSummary | null>(null);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError(""); setSaved(false);
      try {
        if (!user) throw new Error("Sign in with an admin account.");
        const token = await getIdToken();
        if (!token) throw new Error("Sign in with an admin account.");
        const response = await fetch("/api/admin/company-graph/budget", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load the company graph budget.");
        if (!controller.signal.aborted) { setBudget(payload); setLimit(payload.limitUsd.toFixed(2)); }
      } catch (error) {
        if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : String(error)); setBudget(null); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load();
    return () => controller.abort();
  }, [getIdToken, loading, refresh, user]);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const limitUsd = Number(limit);
      if (!limit.trim() || !Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 1_000_000 || Math.round(limitUsd * 100) / 100 !== limitUsd) {
        throw new Error(text("Enter a daily limit from US$0 to US$1,000,000 with no more than two decimal places.", "请输入 0 至 1,000,000 美元的每日限额，最多保留两位小数。"));
      }
      if (!user) throw new Error(text("Sign in with an admin account.", "请使用管理员账户登录。"));
      const token = await getIdToken();
      if (!token) throw new Error(text("Sign in with an admin account.", "请使用管理员账户登录。"));
      const response = await fetch("/api/admin/company-graph/budget", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ limitUsd }), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || text("Unable to save the company graph budget. Refresh to check the current limit.", "无法保存公司关系图预算。请刷新以确认当前限额。"));
      setBudget(payload); setLimit(payload.limitUsd.toFixed(2)); setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  }

  return <section aria-labelledby="graph-budget-heading" className="my-6 rounded-xl border border-slate-700 bg-slate-900/50 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="graph-budget-heading" className="text-lg font-semibold">{text("Company graph OpenAI budget", "公司关系图 OpenAI 预算")}</h2>
      <button className={button} disabled={busy || saving} onClick={() => setRefresh(n => n + 1)}>{text("Refresh budget", "刷新预算")}</button>
    </div>
    <p className="mt-2 text-sm text-slate-400">{text("Daily cap for company graph OpenAI API calls. Usage is an estimate for this pipeline, not your provider invoice or ChatGPT allowance.", "公司关系图 OpenAI API 调用的每日上限。此处为该流程的用量估算，并非供应商账单或 ChatGPT 额度。")}</p>
    {busy && <p role="status" className="mt-4 text-sm">{text("Loading graph budget…", "正在加载关系图预算…")}</p>}
    {!busy && budget && <>
      {budget.newRequestsPaused && <p id="graph-paid-request-pause" role="status" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-200">{text("New paid requests are temporarily paused while spending safeguards are reviewed. You can still edit the daily limit, but raising it will not resume new paid requests.", "费用控制措施审核期间，新的付费请求已临时暂停。您仍可编辑每日限额，但提高限额不会恢复新的付费请求。")}</p>}
      <p className="mt-3 text-sm text-slate-400">{text("Budget day", "预算日期")}: {budget.day} · {budget.timezone}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[[text("Daily limit", "每日上限"), budget.limitUsd], [text("Settled estimate", "已结算估算"), budget.spentUsd], [text("Reserved", "已预留"), budget.reservedUsd], [text("Remaining", "剩余额度"), budget.remainingUsd]].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-slate-950 p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 break-all text-lg font-semibold">{graphBudgetMoney(Number(value))}</dd></div>)}
      </dl>
      {budget.blocked && <p role="status" className="mt-3 text-sm text-amber-300">{budget.limitUsd === 0 ? text("Paused. New OpenAI calls are blocked.", "已暂停。新的 OpenAI 调用已被阻止。") : text("New OpenAI calls are blocked by the budget or pricing validity checks.", "预算或定价有效期检查已阻止新的 OpenAI 调用。")}</p>}
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="grid gap-2 text-sm" htmlFor="graph-budget-limit">{text("Daily limit (USD)", "每日限额（美元）")}
          <input id="graph-budget-limit" className="w-48 max-w-full rounded-lg border border-slate-600 bg-slate-950 p-2" type="number" min="0" max="1000000" step="0.01" required value={limit} disabled={saving} onChange={event => { setLimit(event.target.value); setSaved(false); }} aria-describedby={budget.newRequestsPaused ? "graph-paid-request-pause graph-budget-help" : "graph-budget-help"} />
        </label>
        <button className={button} disabled={saving} type="submit">{saving ? text("Saving budget…", "正在保存预算…") : text("Save daily limit", "保存每日限额")}</button>
      </form>
      <p id="graph-budget-help" className="mt-3 text-xs text-slate-400">{text("Set 0 to pause new calls. Lowering the limit below settled plus reserved usage blocks new calls; it does not reverse charges. Daily spending resets at midnight in America/New_York. Unsettled reservations carry over.", "设为 0 可暂停新调用。将上限降至已结算与预留用量之和以下会阻止新调用，但不会撤销费用。每日已结算用量在 America/New_York 时区的午夜重置，未结算的预留额度会结转。")}</p>
      <p className="mt-2 text-xs text-slate-500">{text("Pricing valid until", "定价有效期至")}: {budget.pricingValidUntil}</p>
    </>}
    {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
    {saved && <p role="status" className="mt-3 text-sm text-emerald-300">{text("Daily limit saved.", "每日限额已保存。")}</p>}
  </section>;
}

export function AdminJobsPage() {
  const { user, loading, getIdToken } = useAuth();
  const { text } = useLocale();
  const [query, setQuery] = useState<{ job: JobId; view: HistoryView; tokens: string[]; run?: Pick<JobRecord, "runId" | "execution"> }>({ job: "fundamentals", view: "runs", tokens: [""] });
  const [data, setData] = useState<JobHistoryPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [rerunning, setRerunning] = useState(false);
  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError("");
      try {
        if (!user) throw new Error("Sign in with an admin account.");
        const token = await getIdToken();
        if (!token) throw new Error("Sign in with an admin account.");
        const params = new URLSearchParams({ job: query.job, view: query.view });
        const cursor = query.tokens.at(-1);
        if (cursor) params.set("pageToken", cursor);
        if (query.run?.runId) params.set("runId", query.run.runId);
        if (query.run?.execution) params.set("execution", query.run.execution);
        const response = await fetch(`/api/admin/jobs?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load job history.");
        if (!controller.signal.aborted) setData(payload);
      } catch (error) {
        if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : String(error)); setData(null); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load();
    return () => controller.abort();
  }, [query, refresh, getIdToken, loading, user]);

  function changeView(view: HistoryView) { setQuery({ job: query.job, view, tokens: [""] }); }
  const activeJob = scheduledJobs[query.job];
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 text-slate-100">
    <Link href="/admin" className="text-sm text-cyan-300">{text("← Admin dashboard", "← 管理面板")}</Link>
    <h1 className="mt-4 text-3xl font-semibold">{text("Tasks", "任务")}</h1>
    <p className="mt-2 text-sm text-slate-400">{text("Review run status, results and errors. Log history is retained for 30 days. Times below use your local timezone.", "查看运行状态、结果和错误。日志保留 30 天。下方时间使用您的本地时区。")}</p>
    <AdminGraphBudget />
    <div className="my-6 flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm">{text("Job", "任务")}
        <select aria-label={text("Job", "任务")} disabled={rerunning} className="max-w-full rounded-lg border border-slate-600 bg-slate-900 p-2" value={query.job}
          onChange={e => setQuery({ job: e.target.value as JobId, view: "runs", tokens: [""] })}>
          {Object.entries(scheduledJobs).map(([id, job]) => <option value={id} key={id}>{text(job.name, chineseNames[id as JobId])}</option>)}
        </select>
      </label>
      <button className={button} disabled={busy} onClick={() => { setQuery(q => ({ ...q, tokens: [""] })); setRefresh(n => n + 1); }}>{text("Refresh", "刷新")}</button>
      <p className="py-2 text-sm text-slate-400">{text(activeJob.schedule, chineseSchedules[query.job] || activeJob.schedule)}</p>
    </div>
    {(query.job === "us" || query.job === "china") && <AdminEodRerun key={query.job} job={query.job} onBusy={setRerunning} onComplete={() => { changeView("runs"); setRefresh(n => n + 1); }} />}
    {(query.job === "fundamentals" || query.job === "cnFundamentals" || query.job === "privateValuations" || query.job === "directory") && <AdminSecRerun key={query.job} job={query.job} onBusy={setRerunning} onComplete={() => { changeView("runs"); setRefresh(n => n + 1); }} />}
    {query.job === "tickers" && <AdminTickerSync onBusy={setRerunning} onComplete={() => { changeView("runs"); setRefresh(n => n + 1); }} />}
    {query.job === "fundamentals" && <p className="mb-4 text-sm text-slate-400">{text("A successful publisher run means batches were queued. Select SEC fundamentals batches to inspect processing outcomes.", "发布任务成功表示批次已排队。请选择 SEC 财务批次查看处理结果。")}</p>}
    {query.job === "companyGraph" && <p className="mb-4 text-sm text-slate-400">{text("A successful publisher run means requests were queued. Select Company graph processing to inspect extraction outcomes.", "发布任务成功表示请求已排队。请选择公司关系图处理查看提取结果。")}</p>}
    {query.job === "companyGraphBatches" && <p className="mb-4 text-sm text-slate-400">{text("Request and filing deliveries retry independently. Check run details for the request ID, accession and extraction outcome.", "请求和文件事件独立重试。请在运行详情中查看请求编号、文件编号和提取结果。")}</p>}
    {query.job === "secFilings" && <p className="mb-4 text-sm text-slate-400">{text("Discovery queues filing events. Check SEC fundamentals batches and Company graph processing for independent results.", "文件发现任务将事件加入队列。请分别查看 SEC 财务批次和公司关系图处理的结果。")}</p>}
    {query.job === "privateValuations" && <p className="mb-4 text-sm text-slate-400">{text("A successful publisher run means checks were queued. Select Private valuation checks to inspect results.", "发布任务成功表示检查已排队。请选择私人公司估值检查查看结果。")}</p>}
    {query.job === "cnFundamentals" && <p className="mb-4 text-sm text-slate-400">{text("A successful publisher run means checks were queued. Select A-share fundamentals checks for results.", "发布任务成功表示检查已排队。请选择 A 股财务检查查看结果。")}</p>}
    {query.job === "directory" && <p className="mb-4 text-sm text-slate-400">{text("A successful publisher run means an import was queued. Select China directory imports for results.", "发布任务成功表示导入已排队。请选择中国目录导入查看结果。")}</p>}
    <nav aria-label={text("Job history views", "任务历史视图")} className="mb-4 flex flex-wrap gap-2">
      {([ ["runs", "Runs", "运行记录"], ["errors", "Errors & warnings", "错误和警告"], ["scheduler", "Scheduler deliveries", "调度触发记录"] ] as const).filter(([view]) => view !== "scheduler" || activeJob.scheduler).map(([view, en, zh]) =>
        <button key={view} onClick={() => changeView(view)} aria-pressed={query.view === view && !query.run} className={`${button} ${query.view === view && !query.run ? "border-cyan-400 bg-cyan-950 text-cyan-100" : ""}`}>{text(en, zh)}</button>)}
    </nav>
    {query.run && <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <button className={button} onClick={() => changeView("runs")}>{text("Back to runs", "返回运行记录")}</button>
      <span className="break-all">{query.run.execution || query.run.runId}</span>
      <button className={button} onClick={() => setQuery(q => ({ ...q, view: q.view === "errors" ? "logs" : "errors", tokens: [""] }))}>{query.view === "errors" ? text("Show all logs", "显示所有日志") : text("Errors only", "仅错误和警告")}</button>
    </div>}
    {query.view === "scheduler" && <p className="mb-4 text-sm text-slate-400">{text("Delivered means the scheduler reached its target. Check Runs for the actual job outcome.", "已送达表示调度器已触发目标。实际任务结果请查看运行记录。")}</p>}
    {busy && <p role="status" className="py-8">{text("Loading job history…", "正在加载任务历史…")}</p>}
    {error && <p role="alert" className="rounded-xl border border-rose-700 p-4 text-rose-300">{error}</p>}
    {!busy && data?.warning && <p role="alert" className="mb-4 text-amber-300">{data.warning}</p>}
    {!busy && data && <>
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-slate-900 text-slate-400"><tr>
            <th className="p-4">{text("Started / ended", "开始 / 结束")}</th><th className="p-4">{text("Status", "状态")}</th><th className="p-4">{text("Results & details", "结果和详情")}</th>
          </tr></thead>
          <tbody>{data.records.map(record => <tr key={record.id} className="border-t border-slate-800 align-top">
            <td className="whitespace-nowrap p-4"><time>{date(record.startedAt)}</time>{record.endedAt && <div className="mt-1 text-xs text-slate-500">{date(record.endedAt)}</div>}{record.durationMs !== undefined && <div className="mt-1 text-xs text-slate-500">{(record.durationMs / 1000).toFixed(1)}s</div>}</td>
            <td className="p-4"><span className={`inline-block rounded-full px-2 py-1 text-xs ${/failed|ERROR|CRITICAL|ALERT|EMERGENCY/i.test(record.status) ? "bg-rose-950 text-rose-300" : /Succeeded|Delivered/.test(record.status) ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>{text(record.status, statusLabels[record.status] || record.status)}</span></td>
            <td className="max-w-xl p-4"><p className="break-words text-slate-300">{summary(record) || text("No result log available yet.", "尚无结果日志。")}</p>
              <details className="mt-2"><summary className="cursor-pointer text-cyan-300">{text("Details", "详情")}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify(record.summary, null, 2)}</pre></details>
              {query.view === "runs" && <button className="mt-3 text-cyan-300 underline" onClick={() => setQuery({ job: query.job, view: "logs", tokens: [""], run: { runId: record.runId, execution: record.execution } })}>{text("View run logs", "查看运行日志")}</button>}
            </td>
          </tr>)}</tbody>
        </table>
        {!data.records.length && <p className="p-6 text-sm text-slate-400">{text("No records on this page.", "本页无记录。")}</p>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button className={button} disabled={query.tokens.length === 1} onClick={() => setQuery(q => ({ ...q, tokens: q.tokens.slice(0, -1) }))}>{text("Previous", "上一页")}</button>
        <span className="text-sm text-slate-400">{text("Page", "页")} {query.tokens.length}</span>
        <button className={button} disabled={!data.nextPageToken} onClick={() => setQuery(q => ({ ...q, tokens: [...q.tokens, data.nextPageToken!] }))}>{text("Next", "下一页")}</button>
      </div>
    </>}
  </main>;
}
