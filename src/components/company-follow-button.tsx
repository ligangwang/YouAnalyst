"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { companyFollowSignIn, persistCompanyFollow } from "@/lib/company-follow-intent";

type Snapshot = { uid: string | null; ids: string[]; ready: boolean; error: boolean };
const empty: Snapshot = { uid: null, ids: [], ready: false, error: false };
let state = empty, version = 0;
let inFlight: string | null = null;
let writeQueue = Promise.resolve();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = (value: Snapshot) => { state = value; listeners.forEach(fn => fn()); };
const getSnapshot = () => state;
const serverSnapshot = () => empty;

export function useCompanyFollows() {
  const { user, loading, getIdToken } = useAuth();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const uid = user?.uid ?? null;
  const refresh = useCallback(async () => {
    if (!uid) { version++; inFlight = null; emit(empty); return; }
    if (inFlight === uid) return;
    inFlight = uid;
    const request = ++version;
    if (state.uid !== uid) emit({ uid, ids: [], ready: false, error: false });
    try {
      const token = await getIdToken();
      if (!token) throw new Error();
      const r = await fetch("/api/map-follows", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!Array.isArray(data.companyIds)) throw new Error();
      if (request === version) emit({ uid, ids: data.companyIds, ready: true, error: false });
    } catch { if (request === version) emit({ uid, ids: state.uid === uid ? state.ids : [], ready: false, error: true }); }
    finally { if (inFlight === uid) inFlight = null; }
  }, [uid, getIdToken]);
  useEffect(() => {
    void refresh();
    const onStorage = (e: StorageEvent) => { if (e.key === "ya-company-follows") void refresh(); };
    const reload = () => { void refresh(); };
    window.addEventListener("focus", reload);
    window.addEventListener("company-follows-changed", reload);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("focus", reload); window.removeEventListener("company-follows-changed", reload); window.removeEventListener("storage", onStorage); };
  }, [refresh]);
  const change = async (companyId: string, follow: boolean) => {
    if (!uid) throw new Error("Sign in required");
    const job = writeQueue.then(async () => {
      if (state.uid !== uid) throw new Error("Account changed");
      const ids = await persistCompanyFollow(companyId, follow, getIdToken);
      if (state.uid === uid) { version++; emit({ uid, ids, ready: true, error: false }); }
      try { localStorage.setItem("ya-company-follows", String(Date.now())); } catch { /* Focus refresh also synchronizes tabs. */ }
    });
    writeQueue = job.catch(() => {});
    return job;
  };
  return { user, loading, ids: snapshot.uid === uid ? snapshot.ids : [], ready: snapshot.uid === uid && snapshot.ready, error: snapshot.uid === uid && snapshot.error, refresh, change };
}

export function CompanyFollowButton({ companyId }: { companyId: string }) {
  const { text } = useLocale();
  const follows = useCompanyFollows();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const followed = follows.ids.includes(companyId);
  async function click() {
    if (!follows.user) { window.location.assign(companyFollowSignIn(companyId, window.location.pathname + window.location.search + window.location.hash)); return; }
    if (!follows.ready) { void follows.refresh(); return; }
    setBusy(true); setError(false);
    try { await follows.change(companyId, !followed); } catch { setError(true); } finally { setBusy(false); }
  }
  return <span className="inline-flex flex-col items-start gap-1"><button type="button" aria-pressed={followed} title={followed ? text("Unfollow company", "取消关注") : text("Follow company privately", "私密关注公司")} disabled={busy || follows.loading || (!!follows.user && !follows.ready && !follows.error)} onClick={() => void click()} className="rounded-full border border-cyan-400/40 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50">{busy ? text("Saving…", "保存中…") : follows.error ? text("Retry follow status", "重试关注状态") : followed ? text("Following", "已关注") : text("＋ Follow", "＋关注")}</button>{error && <span role="alert" className="text-xs text-rose-300">{text("Could not save. Please retry.", "保存失败，请重试。")}</span>}</span>;
}
