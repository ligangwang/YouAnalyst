"use client";

import { UiText } from "@/components/ui-text";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MyWatchlistsPage } from "@/components/my-watchlists-page";
import { PublicWatchlistsPage } from "@/components/public-watchlists-page";
import { useAuth } from "@/components/providers/auth-provider";
import type { PublicWatchlistSummary } from "@/lib/watchlists/service";

type WatchlistsTab = "community" | "mine";

function normalizeTab(value: string | null | undefined): WatchlistsTab {
  return value === "mine" ? "mine" : "community";
}

export function WatchlistsPage({
  publicWatchlists,
  initialTab,
}: {
  publicWatchlists: PublicWatchlistSummary[];
  initialTab?: string | null;
}) {
  const router = useRouter();
  const { user, features } = useAuth();
  const [activeTab, setActiveTab] = useState<WatchlistsTab>(normalizeTab(initialTab));
  const communityWatchlists = useMemo(
    () => publicWatchlists.filter((watchlist) => !user || watchlist.owner.id !== user.uid),
    [publicWatchlists, user],
  );
  const proFeaturesEnabled = features.proFeaturesEnabled;

  useEffect(() => {
    setActiveTab(normalizeTab(initialTab));
  }, [initialTab]);

  function selectTab(nextTab: WatchlistsTab) {
    setActiveTab(nextTab);
    router.replace(nextTab === "mine" ? "/watchlists?tab=mine" : "/watchlists");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-5">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-4 shadow-[0_8px_40px_rgba(8,47,73,0.45)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl"><UiText text={"Watchlists"} /></h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              {proFeaturesEnabled
                ? <UiText text={"Browse top-performing community watchlists or manage your own public and private research workspace."} />
                : <UiText text={"Browse top-performing community watchlists or manage your own public research workspace."} />}
            </p>
          </div>
        </div>

        <div className="mt-4 inline-flex rounded-full border border-slate-700 bg-slate-950/70 p-1 text-sm">
          <button
            type="button"
            onClick={() => selectTab("community")}
            className={`rounded-full px-4 py-2 font-medium transition ${
              activeTab === "community" ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"
            }`}
          ><UiText text={"Community"} /></button>
          <button
            type="button"
            onClick={() => selectTab("mine")}
            className={`rounded-full px-4 py-2 font-medium transition ${
              activeTab === "mine" ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"
            }`}
          ><UiText text={"My Watchlists"} />{!user ? <span className="ml-2 text-[11px] uppercase tracking-wide opacity-80"><UiText text={"Sign in"} /></span> : null}
          </button>
        </div>
      </section>

      <div className="mt-4">
        {activeTab === "mine" ? (
          <MyWatchlistsPage embedded />
        ) : (
          <PublicWatchlistsPage watchlists={communityWatchlists} embedded showHeader={false} />
        )}
      </div>
    </main>
  );
}
