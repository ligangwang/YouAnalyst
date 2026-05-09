"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { FollowedInstitution } from "@/lib/securities/institution-follows";

type FollowedInstitutionsResponse = {
  items?: FollowedInstitution[];
  error?: string;
};

type FollowSort = "recent" | "name" | "report";

function formatDate(value: string | null): string {
  return value || "Unknown";
}

function institutionMatches(institution: FollowedInstitution, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const cikFilter = normalized.replace(/\D/g, "");

  return (
    institution.name.toLowerCase().includes(normalized) ||
    (cikFilter.length > 0 && institution.cik.includes(cikFilter))
  );
}

function sortInstitutions(items: FollowedInstitution[], sort: FollowSort): FollowedInstitution[] {
  return [...items].sort((left, right) => {
    if (sort === "name") {
      return left.name.localeCompare(right.name);
    }

    if (sort === "report") {
      return (right.latestReportDate ?? "").localeCompare(left.latestReportDate ?? "");
    }

    return right.followedAt.localeCompare(left.followedAt);
  });
}

export function FollowedInstitutionsPanel() {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [items, setItems] = useState<FollowedInstitution[]>([]);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FollowSort>("recent");
  const [savingCik, setSavingCik] = useState<string | null>(null);
  const visibleItems = useMemo(() => (
    sortInstitutions(items.filter((institution) => institutionMatches(institution, query)), sort)
  ), [items, query, sort]);

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
          setItems([]);
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

  async function unfollowInstitution(cik: string) {
    if (!user || savingCik) {
      return;
    }

    setSavingCik(cik);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in to manage followed institutions.");
      }

      const response = await fetch(`/api/institutions/${encodeURIComponent(cik)}/follow`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to unfollow institution.");
      }

      setItems((currentItems) => currentItems.filter((institution) => institution.cik !== cik));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to unfollow institution.");
    } finally {
      setSavingCik(null);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Followed institutions</h2>
          <p className="mt-1 text-sm text-slate-400">Managers saved to your institutional research list.</p>
        </div>
        {!loading && items.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="grid gap-1 text-xs text-slate-400">
              Search
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Institution or CIK"
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as FollowSort)}
                className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
              >
                <option value="recent">Recently followed</option>
                <option value="name">Name</option>
                <option value="report">Latest report</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

      {loading ? <p className="text-sm text-slate-300">Loading followed institutions...</p> : null}

      {!loading && visibleItems.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((institution) => (
            <article
              key={institution.cik}
              className="rounded-xl border border-white/10 bg-slate-900/60 p-4"
            >
              <Link href={`/institutions/${institution.cik}`} className="font-semibold text-cyan-100 hover:text-cyan-300">
                {institution.name}
              </Link>
              <p className="mt-1 text-xs text-slate-500">CIK {institution.cik}</p>
              <div className="mt-4 grid gap-1 text-sm text-slate-300">
                <p>Quarter {institution.latestQuarter ?? "Unknown"}</p>
                <p>Report {formatDate(institution.latestReportDate)}</p>
              </div>
              <button
                type="button"
                onClick={() => void unfollowInstitution(institution.cik)}
                disabled={savingCik === institution.cik}
                className="mt-4 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-60"
              >
                {savingCik === institution.cik ? "Saving..." : "Unfollow"}
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && items.length > 0 && visibleItems.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No followed institutions match the current filters.
        </p>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No followed institutions yet.
        </p>
      ) : null}
    </section>
  );
}
