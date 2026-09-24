"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "@/components/providers/locale-provider";
import { AdminEodRerun } from "./admin-eod-rerun";
import { AdminSecRerun } from "./admin-sec-rerun";
import { scheduledJobs, type JobId, type HistoryView, type JobHistoryPage, type JobRecord } from "@/lib/admin-jobs/model";

const button = "rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40";
const chineseNames = { fundamentals: "SEC 财务数据", cnFundamentals: "A 股股本与市值", directory: "中国公司目录", us: "美国收盘维护", china: "中国收盘维护" };
const statusLabels: Record<string, string> = { Succeeded: "成功", Failed: "失败", Cancelled: "已取消", Starting: "启动中", Running: "运行中", Unknown: "未知", "No completion recorded": "无完成记录", "Completed with errors": "完成但有错误", "Delivery started": "开始触发", "Delivery failed": "触发失败", Delivered: "已送达" };
function date(value: string) { return value ? new Date(value).toLocaleString() : "—"; }
function summary(record: JobRecord): string {
  const fields = record.summary;
  const counts = ["processed", "failed", "remaining", "companies", "count", "created", "updated", "unchanged"]
    .filter(key => typeof fields[key] === "number").map(key => `${key}: ${fields[key]}`);
  if (fields.priceLoad) counts.push(`prices: ${JSON.stringify(fields.priceLoad)}`);
  if (fields.fx) counts.push(`FX: ${JSON.stringify(fields.fx)}`);
  if (fields.marketCaps) counts.push(`market caps: ${JSON.stringify(fields.marketCaps)}`);
  if (fields.shares) counts.push(`shares: ${JSON.stringify(fields.shares)}`);
  if (fields.actions) counts.push(`corporate actions: ${JSON.stringify(fields.actions)}`);
  if (fields.coverage) counts.push(`coverage: ${JSON.stringify(fields.coverage)}`);
  return counts.join(" · ") || record.message || String((fields.error as { message?: string } | undefined)?.message ?? "");
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
    <h1 className="mt-4 text-3xl font-semibold">{text("Scheduled jobs", "定时任务")}</h1>
    <p className="mt-2 text-sm text-slate-400">{text("Review run status, results and errors. Log history is retained for 30 days. Times below use your local timezone.", "查看运行状态、结果和错误。日志保留 30 天。下方时间使用您的本地时区。")}</p>
    <div className="my-6 flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm">{text("Job", "任务")}
        <select aria-label={text("Job", "任务")} disabled={rerunning} className="max-w-full rounded-lg border border-slate-600 bg-slate-900 p-2" value={query.job}
          onChange={e => setQuery({ job: e.target.value as JobId, view: "runs", tokens: [""] })}>
          {Object.entries(scheduledJobs).map(([id, job]) => <option value={id} key={id}>{text(job.name, chineseNames[id as JobId])}</option>)}
        </select>
      </label>
      <button className={button} disabled={busy} onClick={() => { setQuery(q => ({ ...q, tokens: [""] })); setRefresh(n => n + 1); }}>{text("Refresh", "刷新")}</button>
      <p className="py-2 text-sm text-slate-400">{activeJob.schedule}</p>
    </div>
    {(query.job === "us" || query.job === "china") && <AdminEodRerun key={query.job} job={query.job} onBusy={setRerunning} onComplete={() => { changeView("runs"); setRefresh(n => n + 1); }} />}
    {(query.job === "fundamentals" || query.job === "cnFundamentals") && <AdminSecRerun key={query.job} job={query.job} onBusy={setRerunning} onComplete={() => { changeView("runs"); setRefresh(n => n + 1); }} />}
    <nav aria-label={text("Job history views", "任务历史视图")} className="mb-4 flex flex-wrap gap-2">
      {([ ["runs", "Runs", "运行记录"], ["errors", "Errors & warnings", "错误和警告"], ["scheduler", "Scheduler deliveries", "调度触发记录"] ] as const).map(([view, en, zh]) =>
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
