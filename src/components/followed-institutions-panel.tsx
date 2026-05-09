"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { FollowedInstitution } from "@/lib/securities/institution-follows";

type FollowedInstitutionsResponse = {
  items?: FollowedInstitution[];
  error?: string;
};

function formatDate(value: string | null): string {
  return value || "Unknown";
}

export function FollowedInstitutionsPanel() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [items, setItems] = useState<FollowedInstitution[]>([]);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    let cancelled = false;

    void getIdToken()
      .then(async (token) => {
        if (!token) {
          throw new Error("Sign in to load followed institutions.");
        }

        const response = await fetch("/api/institutions/follows?limit=12", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as FollowedInstitutionsResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load followed institutions.");
        }

        if (!cancelled) {
          setItems(payload.items ?? []);
          setLoadedForUser(user.uid);
          setError(null);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load followed institutions.");
          setLoadedForUser(user.uid);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, getIdToken, user]);

  if (authLoading) {
    return null;
  }

  if (!user) {
    return (
      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Follow institutions</h2>
            <p className="mt-1 text-sm text-slate-400">Sign in to save managers you want to revisit.</p>
          </div>
          <Link href="/auth" className="w-fit rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  const loading = loadedForUser !== user.uid;

  return (
    <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="mb-4">
        <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Followed institutions</h2>
        <p className="mt-1 text-sm text-slate-400">Managers saved to your institutional research list.</p>
      </div>

      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      {loading ? <p className="text-sm text-slate-300">Loading followed institutions...</p> : null}

      {!loading && items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((institution) => (
            <Link
              key={institution.cik}
              href={`/institutions/${institution.cik}`}
              className="rounded-xl border border-white/10 bg-slate-900/60 p-4 transition hover:border-cyan-300/60 hover:bg-slate-900"
            >
              <p className="font-semibold text-cyan-100">{institution.name}</p>
              <p className="mt-1 text-xs text-slate-500">CIK {institution.cik}</p>
              <div className="mt-4 grid gap-1 text-sm text-slate-300">
                <p>Quarter {institution.latestQuarter ?? "Unknown"}</p>
                <p>Report {formatDate(institution.latestReportDate)}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No followed institutions yet.
        </p>
      ) : null}
    </section>
  );
}
