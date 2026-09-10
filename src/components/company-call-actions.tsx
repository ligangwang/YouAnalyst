"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { CompanyCall } from "@/lib/predictions/company-calls";
import { CompanyDirectionActions } from "./company-direction-actions";

export function CompanyCallActions({ ticker }: { ticker: string }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status" className="mt-4 text-sm text-slate-400">Loading your outlook…</p>;
  if (!user) return <div className="mt-4"><CompanyDirectionActions ticker={ticker} /></div>;
  return <ViewerCalls key={`${user.uid}:${ticker}`} ticker={ticker} />;
}

function ViewerCalls({ ticker }: { ticker: string }) {
  const { getIdToken } = useAuth();
  const [items, setItems] = useState<CompanyCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { const refresh = () => setAttempt(value => value + 1); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const token = await getIdToken();
        if (!token) throw new Error("Sign in to view your calls.");
        const response = await fetch(`/api/ticker/${encodeURIComponent(ticker)}/my-calls`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (!response.ok) throw new Error("Unable to load your calls. Please retry.");
        const body = await response.json() as { items: CompanyCall[] };
        if (!Array.isArray(body.items)) throw new Error("Unable to load your calls. Please retry.");
        if (!controller.signal.aborted) { setItems(body.items); setError(null); }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load your calls."); }
    }
    void load();
    return () => controller.abort();
  }, [ticker, getIdToken, attempt]);

  async function act(call: CompanyCall, action: "close" | "cancel") {
    if (pending || (action === "close" && !reason.trim())) return;
    setPending(call.id); setError(null); setNotice("");
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in to manage your calls.");
      const response = await fetch(`/api/predictions/${encodeURIComponent(call.id)}/${action}`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(action === "close" ? { reason: reason.trim() } : {}),
      });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error || "Unable to update this call.");
      const status = result.status;
      if (status !== "CANCELED" && status !== "OPEN" && status !== "CLOSING") throw new Error("The result could not be confirmed. Refresh your calls before trying again.");
      setItems(current => status === "CANCELED" ? (current ?? []).filter(item => item.id !== call.id)
        : (current ?? []).map(item => item.id === call.id ? { ...item, status, cancelUntil: null } : item));
      setEditing(null); setReason("");
      setNotice(status === "CLOSING" ? `Closing your ${call.direction === "UP" ? "bullish" : "bearish"} call in ${call.watchlistName}. Settlement is pending the end-of-day update.` : status === "OPEN" ? `The close request was canceled. Your call in ${call.watchlistName} remains open. Refresh to see its latest entry details.` : `Canceled your pending call in ${call.watchlistName}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to update this call."); }
    finally { setPending(null); }
  }

  return <section id="your-company-calls" aria-label={`Your calls on ${ticker}`} className="mt-5 text-sm">
    <h2 className="font-semibold text-slate-100">Your outlook on {ticker}</h2>
    {error && <p role="alert" className="mt-2 text-rose-200">{error} <button type="button" className="underline" disabled={!!pending} onClick={() => setAttempt(value => value + 1)}>Refresh your calls</button></p>}
    {notice && <p role="status" className="mt-2 text-cyan-200">{notice}</p>}
    {!items && !error && <p role="status" className="mt-2 text-slate-400">Loading your calls…</p>}
    {items?.length === 0 && <div className="mt-3"><CompanyDirectionActions ticker={ticker} /></div>}
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {items?.map(call => {
        const label = call.direction === "UP" ? "Bullish" : "Bearish";
        const canCancel = call.cancelUntil && now <= Date.parse(call.cancelUntil);
        return <article key={call.id} aria-label={`${call.watchlistName}: ${label}`} className={`rounded-xl border p-4 ${call.direction === "UP" ? "border-emerald-400/35 bg-emerald-400/5" : "border-rose-400/35 bg-rose-400/5"}`}>
          <h3 className="font-semibold text-white">{call.watchlistName} · {label}</h3>
          <p className="mt-1 text-xs text-slate-400">{call.isDefault ? "Default watchlist · " : ""}{call.visibility}</p>
          <p className="mt-2 text-slate-300">Set {call.createdAt ? new Date(call.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "date unavailable"}</p>
          <p className="mt-1 text-slate-300">{call.entryPrice !== null ? `Entry ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(call.entryPrice)}${call.entryDate ? ` · recorded ${call.entryDate}` : ""}` : "Entry price pending the next end-of-day update."}</p>
          {call.status === "CLOSING" ? <p className="mt-3 text-amber-200">Closing — awaiting end-of-day settlement.</p>
            : call.status === "CREATED" ? canCancel ? <button type="button" disabled={!!pending} onClick={() => void act(call, "cancel")} className="mt-3 min-h-11 rounded-lg border border-white/25 px-4 text-slate-100 disabled:opacity-50">{pending === call.id ? "Canceling…" : `Cancel ${label}`}</button>
              : <p className="mt-3 text-xs text-slate-400">The five-minute cancellation window has ended. Awaiting entry price.</p>
            : editing !== call.id ? <button type="button" disabled={!!pending || call.entryPrice === null || !call.entryDate} onClick={() => { setEditing(call.id); setReason(""); }} className="mt-3 min-h-11 rounded-lg border border-white/25 px-4 font-semibold text-white disabled:opacity-50">Close {label}</button>
              : <form className="mt-3 grid gap-2" onSubmit={event => { event.preventDefault(); void act(call, "close"); }}>
                <label htmlFor={`close-${call.id}`} className="text-slate-200">Why are you closing this call?</label>
                <textarea id={`close-${call.id}`} required value={reason} onChange={event => setReason(event.target.value)} className="rounded-lg border border-white/20 bg-slate-950 p-2 text-white" rows={2} />
                <p className="text-xs text-slate-400">The closing price will be recorded at an end-of-day update. Your reason is visible with this {call.visibility.toLowerCase()} call.</p>
                <div className="flex flex-wrap gap-2"><button type="submit" disabled={!!pending || !reason.trim()} className="min-h-11 rounded-lg bg-cyan-400 px-4 font-semibold text-slate-950 disabled:opacity-50">{pending === call.id ? "Closing…" : `Confirm close ${label}`}</button><button type="button" disabled={!!pending} onClick={() => setEditing(null)} className="min-h-11 px-3 text-slate-300">Keep open</button></div>
              </form>}
          <Link href={`/predictions/${encodeURIComponent(call.id)}`} className="mt-3 block text-cyan-200 underline underline-offset-4">View call and history</Link>
        </article>;
      })}
    </div>
    {!!items?.length && <Link href={`/predictions/new?ticker=${encodeURIComponent(ticker)}`} className="mt-3 inline-block text-cyan-200 underline underline-offset-4">Choose a watchlist for a new call</Link>}
  </section>;
}
