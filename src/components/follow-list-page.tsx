"use client";

import Image from "next/image";
import Link from "next/link";
import { RelativeTime } from "./relative-time";
import { useEffect, useState } from "react";

type FollowListKind = "followers" | "following";

type FollowListItem = {
  userId: string;
  displayName: string | null;
  nickname: string | null;
  photoURL: string | null;
  totalScore: number;
  followersCount: number;
  followingCount: number;
  followedAt: string;
};

type FollowListResponse = {
  items: FollowListItem[];
  nextCursor: string | null;
};

function displayName(item: FollowListItem): string {
  return item.nickname ? `@${item.nickname}` : item.displayName ?? "Anonymous";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "A";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function scoreText(score: number): string {
  const sign = score > 0 ? "+" : "";
  return `Score ${sign}${Math.round(score)}`;
}

function countText(count: number, singular: string, plural = `${singular}s`): string {
  const rounded = Math.max(0, Math.round(count));
  return `${rounded.toLocaleString()} ${rounded === 1 ? singular : plural}`;
}

export function FollowListPage({
  userId,
  kind,
}: {
  userId: string;
  kind: FollowListKind;
}) {
  const [payload, setPayload] = useState<FollowListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const title = kind === "followers" ? "Followers" : "Following";
  const emptyText = kind === "followers" ? "No followers yet." : "Not following anyone yet.";

  useEffect(() => {
    let cancelled = false;

    setPayload(null);
    setError(null);
    setLoadingMore(false);

    void fetch(`/api/users/${userId}/${kind}?limit=25`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load ${kind}.`);
        }

        const nextPayload = (await response.json()) as FollowListResponse;
        if (!cancelled) {
          setPayload(nextPayload);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : `Unable to load ${kind}.`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [kind, userId]);

  async function loadMore() {
    if (!payload?.nextCursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: "25",
        cursorCreatedAt: payload.nextCursor,
      });
      const response = await fetch(`/api/users/${userId}/${kind}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Unable to load more ${kind}.`);
      }

      const nextPayload = (await response.json()) as FollowListResponse;
      setPayload((current) => current
        ? {
            items: [...current.items, ...nextPayload.items],
            nextCursor: nextPayload.nextCursor,
          }
        : nextPayload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Unable to load more ${kind}.`);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!payload) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-8 text-sm text-slate-300">
        {error ?? `Loading ${kind}...`}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <Link href={`/analysts/${userId}`} className="text-xs font-semibold text-cyan-300 hover:text-cyan-100">
          Back to profile
        </Link>
        <h1 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{title}</h1>
      </section>

      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="grid gap-2">
          {payload.items.map((item) => {
            const name = displayName(item);

            return (
              <div
                key={item.userId}
                className="grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-white/10 p-3 hover:border-cyan-300/60 sm:grid-cols-[auto_1fr_auto]"
              >
                <Link href={`/analysts/${item.userId}`} className="contents">
                {item.photoURL ? (
                  <Image
                    src={item.photoURL}
                    alt={`${name} avatar`}
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-full object-cover ring-1 ring-cyan-400/40"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-cyan-600/25 text-sm font-semibold text-cyan-100 ring-1 ring-cyan-400/40">
                    {initials(name)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">{name}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {scoreText(item.totalScore)} / {countText(item.followingCount, "following", "following")} /{" "}
                    {countText(item.followersCount, "follower")}
                  </p>
                </div>
                </Link>
                <p className="col-span-2 text-xs text-slate-500 sm:col-span-1 sm:self-center sm:text-right">
                  <RelativeTime value={item.followedAt} prefix="Followed" />
                </p>
              </div>
            );
          })}

          {payload.items.length === 0 ? <p className="text-sm text-slate-300">{emptyText}</p> : null}

          {payload.nextCursor ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          ) : null}
        </div>

        {error && payload.items.length > 0 ? (
          <p className="mt-3 text-center text-sm text-rose-200">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
