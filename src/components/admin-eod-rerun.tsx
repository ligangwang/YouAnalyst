"use client";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { marketDate } from "@/lib/predictions/instrument";

export function AdminEodRerun({ job, onBusy, onComplete }: { job: "us" | "china"; onBusy: (busy: boolean) => void; onComplete: () => void }) {
  const { getIdToken } = useAuth();
  const { text } = useLocale();
  const [runDate, setRunDate] = useState("");
  const [running, setRunning] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setRunning(true); onBusy(true); setMessage(""); setFailed(false);
    try {
      const token = await getIdToken();
      if (!token) throw new Error(text("Sign in with an admin account.", "请使用管理员账户登录。"));
      const response = await fetch("/api/admin/jobs", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ job, runDate }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || text("The rerun failed. Check run history.", "重新运行失败，请查看运行记录。"));
      setMessage(`${runDate}: ${text("Queued. Follow progress in run history.", "已加入队列，请在运行记录中查看进度。")} ${text("Request", "请求")} ${payload.result.runId ?? ""}`);
    } catch (error) {
      setFailed(true);
      setMessage(`${error instanceof Error ? error.message : String(error)} ${text("Check run history before retrying; an interrupted request may still be running.", "重试前请查看运行记录；请求中断后任务可能仍在运行。")}`);
    } finally {
      pending.current = false; setRunning(false); onBusy(false); onComplete();
    }
  }
  return <section className="mb-6 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
    <h2 className="font-semibold">{text("Rerun EOD maintenance", "重新运行收盘维护")}</h2>
    <p className="mt-2 text-sm text-slate-400">{text("Fetch prices and process predictions for the selected market and date. Existing final prices are reused. Results appear in run history.", "获取所选市场和日期的价格并处理投资观点。已有收盘价格会被复用，结果将显示在运行记录中。")}</p>
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm">{text("Trading date", "交易日期")}
        <input type="date" required aria-label={text("Trading date", "交易日期")} value={runDate} max={marketDate(job === "us" ? "US" : "CN_A")} disabled={running} onChange={e => setRunDate(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-950 p-2 [color-scheme:dark]" />
      </label>
      <button type="submit" disabled={running || !runDate} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{running ? text("Running…", "运行中…") : text("Rerun for this date", "按此日期重新运行")}</button>
    </form>
    {running && <p role="status" className="mt-3 text-sm text-cyan-200">{text("Submitting maintenance to the queue.", "正在将维护任务加入队列。")}</p>}
    {message && <p role={failed ? "alert" : "status"} className={`mt-3 break-words text-sm ${failed ? "text-amber-300" : "text-emerald-300"}`}>{message}</p>}
  </section>;
}
