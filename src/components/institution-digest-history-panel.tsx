"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { InstitutionDigestRunSnapshot } from "@/lib/securities/institution-follows";

type DigestRunsResponse = {
  items?: InstitutionDigestRunSnapshot[];
  error?: string;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    notation: Math.abs(value) >= 1_000_000_000 ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function changeTone(status: string): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

export function InstitutionDigestHistoryPanel() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [items, setItems] = useState<InstitutionDigestRunSnapshot[]>([]);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    let cancelled = false;

    void getIdToken()
      .then(async (token) => {
        if (!token) {
          throw new Error("Sign in to load institution digests.");
        }

        const response = await fetch("/api/institutions/follows/digest/runs?limit=8", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as DigestRunsResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load institution digests.");
        }

        if (!cancelled) {
          setItems(payload.items ?? []);
          setLoadedForUser(user.uid);
          setExpandedRunId(payload.items?.[0]?.id ?? null);
          setError(null);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load institution digests.");
          setLoadedForUser(user.uid);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, user]);

  if (authLoading || !user) {
    return null;
  }

  const loading = loadedForUser !== user.uid;

  return (
    <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="mb-4">
        <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Institution digests</h2>
        <p className="mt-1 text-sm text-slate-400">Saved in-app summaries generated from followed institutions.</p>
      </div>

      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-300">Loading institution digests...</p> : null}

      {!loading && items.length > 0 ? (
        <div className="grid gap-3">
          {items.map((run) => {
            const expanded = expandedRunId === run.id;
            return (
              <article key={run.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-cyan-100">{run.generatedAt}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {run.cadence} / {run.status} / {run.itemCount.toLocaleString()} items
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedRunId(expanded ? null : run.id)}
                    className="w-fit rounded-xl border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
                  >
                    {expanded ? "Hide" : "Open"}
                  </button>
                </div>

                {expanded ? (
                  <div className="mt-4 grid gap-2">
                    {run.items.map((item) => (
                      <div key={`${run.id}_${item.positionKey}`} className="rounded-lg border border-white/10 bg-slate-950/55 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <Link href={`/institutions/${item.managerCik}`} className="font-semibold text-slate-100 hover:text-cyan-200">
                              {item.managerName}
                            </Link>
                            <p className="mt-1 text-sm text-slate-300">
                              {item.ticker ? (
                                <Link href={`/ticker/${item.ticker}`} className="font-semibold text-cyan-100 hover:text-cyan-300">
                                  {item.ticker}
                                </Link>
                              ) : (
                                <span className="font-semibold text-slate-100">Unmapped</span>
                              )}{" "}
                              <span className="text-slate-400">{item.nameOfIssuer}</span>
                            </p>
                          </div>
                          <span className={`w-fit rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(item.status)}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span>Value <strong className="text-slate-100">{formatSignedCurrency(item.valueChangeUsd)}</strong></span>
                          <span>Report <strong className="text-slate-100">{item.reportDate}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No institution digests have been generated yet.
        </p>
      ) : null}
    </section>
  );
}
