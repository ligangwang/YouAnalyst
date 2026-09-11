"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import type { ChinaCompany } from "@/lib/industry-research/china";

type Item = { id: string; name: string; status: string; attempts: number; error?: string; profile?: ChinaCompany; classification?: { name: string }[] };
const control = "rounded-lg border border-white/20 px-3 py-2 disabled:opacity-50";
export function AdminCompanyResearch() {
  const { getIdToken, user } = useAuth(), { text, chinese } = useLocale();
  const [items, setItems] = useState<Item[]>([]), [filter, setFilter] = useState("PENDING"), [cursor, setCursor] = useState("");
  const [next, setNext] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [sync, setSync] = useState<{ snapshot: string; count: number } | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const requestId = useRef<string | null>(null);
  const api = useCallback(async (body?: unknown) => {
    const token = await getIdToken();
    if (!token) throw new Error(chinese ? "请使用管理员账号登录。" : "Sign in as an administrator.");
    const response = await fetch(`/api/admin/company-research?status=${filter}&after=${cursor}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error); return payload;
  }, [getIdToken, filter, cursor, chinese]);
  const reload = useCallback(async () => { const data = await api(); setItems(data.candidates); setNext(data.nextCursor); setSync(data.sync); setChecked([]); }, [api]);
  useEffect(() => { if (user) void reload().catch(e => setError(e.message)); }, [reload, user]);
  useEffect(() => {
    if (!user || !items.some(c => c.status === "RESEARCHING") || busy) return;
    const timer = setTimeout(() => { void api({ action: "refresh" }).then(reload).catch(e => setError(e.message)); }, 10000);
    return () => clearTimeout(timer);
  }, [user, items, busy, api, reload]);
  async function act(action: string, id?: string) {
    setBusy(true); setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      await api({ action, id, retryId: action === "process" ? id : undefined, requestId: requestId.current });
      requestId.current = null;
      await reload();
      if (action === "process") { setFilter("RESEARCHING"); setCursor(""); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-6xl px-4 py-8 text-slate-100">
    <h1 className="text-2xl font-semibold">{text("Company research queue", "公司研究队列")}</h1>
    <p className="my-3 text-slate-400">{text("A-share identities and CNI classifications are imported by the directory sync job. Research produces private drafts for review. Each company uses one request from the shared daily allowance of 100.", "A 股公司与国证行业分类由目录同步任务导入。研究结果先保存为私有草稿，审核后发布。每家公司占用共享每日 100 次研究额度中的一次。")}</p>
    <p>{sync ? text(`${sync.count} companies · CNI snapshot ${sync.snapshot}`, `${sync.count} 家公司 · 国证分类快照 ${sync.snapshot}`) : text("Directory import has not completed yet.", "公司目录尚未完成导入。")}</p>
    <a className="my-3 block text-cyan-300 underline" href="/admin/industry-research">{text("Research industry connections", "研究行业关系")}</a>
    <div className="my-5 flex flex-wrap gap-3">
      <label>{text("Status", "状态")} <select className={`${control} bg-slate-950`} value={filter} onChange={e => { setFilter(e.target.value); setCursor(""); }}>{[["PENDING","Pending","待研究"],["RESEARCHING","Researching","研究中"],["DRAFT","Ready for review","待审核"],["FAILED","Failed","失败"],["PUBLISHED","Published","已发布"]].map(([v,en,zh]) => <option key={v} value={v}>{text(en,zh)}</option>)}</select></label>
      <button className={control} disabled={busy} onClick={() => void act("process")}>{text("Process up to 5 pending companies", "研究最多 5 家待处理公司")}</button>
      <button className={control} disabled={busy} onClick={() => void act("refresh")}>{text("Refresh research results", "刷新研究结果")}</button>
    </div>
    {error && <p role="alert" className="my-3 text-rose-300">{error}</p>}
    <div className="grid gap-4 md:grid-cols-2">{items.map(c => <article key={c.id} className="rounded-xl border border-white/15 p-4">
      <h2 className="font-semibold">{c.name} · {c.id}</h2><p className="text-sm text-slate-400">{c.classification?.map(x => x.name).join(" / ")}</p>
      <p className="my-2 text-sm">{text(`Attempts: ${c.attempts}`, `研究次数：${c.attempts}`)}</p>
      {c.error && <p className="text-rose-300">{c.error}</p>}
      {c.profile && <><p>{c.profile.description}</p><a className="my-3 block text-cyan-300 underline" href={c.profile.source} target="_blank" rel="noopener noreferrer">{c.profile.sourceLabel}</a></>}
      {c.status === "FAILED" && <button className={control} disabled={busy} onClick={() => void act("process", c.id)}>{text("Retry company", "重试此公司")}</button>}
      {c.status === "DRAFT" && <><label className="my-3 block"><input type="checkbox" checked={checked.includes(c.id)} onChange={e => setChecked(v => e.target.checked ? [...v,c.id] : v.filter(id => id !== c.id))} /> {text("I reviewed the company and its sources", "我已核对公司信息与来源")}</label><button className={control} disabled={busy || !checked.includes(c.id)} onClick={() => void act("publish", c.id)}>{text("Publish company", "发布公司")}</button></>}
    </article>)}</div>
    {!items.length && <p>{text("No companies with this status.", "此状态下暂无公司。")}</p>}
    <div className="mt-5 flex gap-3"><button className={control} disabled={busy || !cursor} onClick={() => setCursor("")}>{text("First page", "首页")}</button><button className={control} disabled={busy || !next} onClick={() => setCursor(next!)}>{text("Next page", "下一页")}</button></div>
  </main>;
}
