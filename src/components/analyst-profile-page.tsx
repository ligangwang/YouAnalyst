"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { formatTickerSymbol, PredictionReturnSummary } from "@/components/prediction-ui";
import { analystLevelName } from "@/lib/predictions/analytics";
import { type PredictionStatus } from "@/lib/predictions/types";

type ProfileStatusFilter = "ALL" | "LIVE" | "SETTLED";
type InstitutionDigestCadence = "daily" | "weekly";

type WatchlistPrediction = {
  id: string;
  ticker: string;
  direction: "UP" | "DOWN";
  thesisTitle?: string;
  thesis: string;
  createdAt: string;
  status: PredictionStatus;
  entryPrice: number | null;
  entryDate: string | null;
  markPrice?: number | null;
  markPriceDate?: string | null;
  markReturnValue?: number | null;
  commentCount: number;
  result: {
    score: number;
    returnValue: number;
  } | null;
};

type WatchlistMetrics = {
  liveReturn: number | null;
  settledReturn: number | null;
  livePredictionCount: number;
  settledPredictionCount: number;
};

type WatchlistSummary = {
  id: string;
  name: string;
  description?: string | null;
  metrics: WatchlistMetrics;
};

type WatchlistDetail = {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  metrics: WatchlistMetrics;
  livePredictions: WatchlistPrediction[];
  settledPredictions: WatchlistPrediction[];
};

type WatchlistRequestState = {
  watchlistId: string | null;
  watchlist: WatchlistDetail | null;
  loading: boolean;
  error: string | null;
};

type ProfilePayload = {
  profile: {
    id: string;
    displayName: string | null;
    photoURL: string | null;
    nickname: string | null;
    bio: string;
    accountType?: "HUMAN" | "AI_ANALYST";
    aiAnalyst?: {
      badgeLabel: string;
      coverageTickers: string[];
      disclosureLong: string;
      howItWorks: {
        summary: string;
        methodology: string[];
        rules: string[];
        limitations: string[];
      };
      profileSections: {
        coverageUniverseTitle: string;
        methodologyTitle: string;
        limitationsTitle: string;
      };
    } | null;
    stats: {
      totalPredictions: number;
      openingPredictions: number;
      openPredictions: number;
      closingPredictions: number;
      closedPredictions: number;
      canceledPredictions: number;
      totalScore: number;
      settledCalls: number;
      totalXP: number;
      level: number;
      followersCount: number;
      followingCount: number;
    };
    latestDailyScore: {
      date: string;
      dailyScoreChange: number;
      dailyMarkedPredictions: number;
    } | null;
    settings: {
      isPublic: boolean;
      institutionDigestEnabled: boolean;
      institutionDigestCadence: InstitutionDigestCadence;
      institutionDigestLastSentAt: string | null;
    };
  };
  relationship: {
    isFollowing: boolean;
  };
  watchlists: WatchlistSummary[];
};

function scoreValueText(score: number): string {
  return `${Math.round(score)}`;
}

function xpProgressText(totalXP: number, level: number): string {
  return `${Math.round(totalXP).toLocaleString()} / ${(100 * Math.max(1, level) ** 2).toLocaleString()}`;
}

function statusFilterLabel(status: ProfileStatusFilter): string {
  if (status === "LIVE") {
    return "Live";
  }
  if (status === "SETTLED") {
    return "Settled";
  }
  return "All";
}

function countText(count: number, singular: string, plural = `${singular}s`): string {
  const rounded = Math.max(0, Math.round(count));
  return `${rounded.toLocaleString()} ${rounded === 1 ? singular : plural}`;
}

function watchlistReturnText(value: number | null): string {
  if (typeof value !== "number") {
    return "Not marked";
  }
  const percent = value * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function predictionStatusLabel(status: PredictionStatus): string {
  if (status === "CREATED") {
    return "Awaiting entry";
  }
  if (status === "OPEN") {
    return "Live";
  }
  if (status === "CLOSING") {
    return "Closing";
  }
  if (status === "SETTLED") {
    return "Settled";
  }
  return "Canceled";
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ProfileWatchlistPredictionRow({ prediction }: { prediction: WatchlistPrediction }) {
  const title = prediction.thesisTitle?.trim();

  return (
    <article className="border-t border-white/10 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/predictions/${prediction.id}`}
            className="flex w-fit items-center gap-1 text-base font-semibold text-cyan-200 hover:text-cyan-100"
            aria-label={`${prediction.direction === "UP" ? "Up" : "Down"} prediction for ${prediction.ticker}`}
          >
            <span aria-hidden="true">{prediction.direction === "UP" ? "\u2191" : "\u2193"}</span>
            <span>{formatTickerSymbol(prediction.ticker)}</span>
          </Link>
          {title ? <p className="mt-1 truncate text-sm text-slate-300">{title}</p> : null}
          <PredictionReturnSummary prediction={prediction} href={`/predictions/${prediction.id}`} status={prediction.status} />
        </div>
        <div className="shrink-0 text-right text-xs text-slate-500">
          <p>{predictionStatusLabel(prediction.status)}</p>
          <p className="mt-1">{prediction.commentCount.toLocaleString()} comments</p>
        </div>
      </div>
    </article>
  );
}

export function AnalystProfilePage({
  userId,
  promptForNickname = false,
}: {
  userId: string;
  promptForNickname?: boolean;
}) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const isOwner = Boolean(user && user.uid === userId);
  const [status, setStatus] = useState<ProfileStatusFilter>("ALL");
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editNickname, setEditNickname] = useState("");
  const [editBio, setEditBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nicknamePromptOpened, setNicknamePromptOpened] = useState(false);
  const [followSaving, setFollowSaving] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [digestSaving, setDigestSaving] = useState(false);
  const [digestMessage, setDigestMessage] = useState<string | null>(null);
  const [digestError, setDigestError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);
  const [watchlistState, setWatchlistState] = useState<WatchlistRequestState>({
    watchlistId: null,
    watchlist: null,
    loading: false,
    error: null,
  });
  const preferredName = payload?.profile.nickname ?? payload?.profile.displayName ?? "Analyst";
  const badgePath = `/api/users/${userId}/badge.svg`;
  const profilePath = `/analysts/${userId}`;
  const settledCalls = payload?.profile.stats.settledCalls ?? payload?.profile.stats.closedPredictions ?? 0;

  const fetchProfile = useCallback(async (): Promise<ProfilePayload> => {
    const token = await getIdToken();
    const response = await fetch(`/api/users/${userId}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });

    if (!response.ok) {
      throw new Error("Unable to load analyst profile.");
    }

    return (await response.json()) as ProfilePayload;
  }, [getIdToken, userId]);

  function beginWatchlistLoad(nextWatchlistId: string, fallback?: WatchlistDetail | null) {
    if (nextWatchlistId === selectedWatchlistId && !watchlistState.error) {
      return;
    }

    setSelectedWatchlistId(nextWatchlistId);
    setWatchlistState({
      watchlistId: nextWatchlistId,
      watchlist: fallback ?? null,
      loading: true,
      error: null,
    });
  }

  useEffect(() => {
    let cancelled = false;

    void fetchProfile()
      .then((nextPayload) => {
        if (cancelled) {
          return;
        }

        setPayload(nextPayload);
        setLoading(false);
        setError(null);

        const firstWatchlist = nextPayload.watchlists[0];
        if (firstWatchlist) {
          setSelectedWatchlistId(firstWatchlist.id);
          setWatchlistState({
            watchlistId: firstWatchlist.id,
            watchlist: null,
            loading: true,
            error: null,
          });
        } else {
          setSelectedWatchlistId(null);
          setWatchlistState({
            watchlistId: null,
            watchlist: null,
            loading: false,
            error: null,
          });
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load profile.");
          setPayload(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchProfile]);

  useEffect(() => {
    if (!selectedWatchlistId) {
      return;
    }

    let cancelled = false;

    void fetch(`/api/watchlists/${selectedWatchlistId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load watchlist.");
        }
        return (await response.json()) as { watchlist: WatchlistDetail };
      })
      .then((response) => {
        if (!cancelled) {
          setWatchlistState({
            watchlistId: selectedWatchlistId,
            watchlist: response.watchlist,
            loading: false,
            error: null,
          });
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setWatchlistState({
            watchlistId: selectedWatchlistId,
            watchlist: null,
            loading: false,
            error: nextError instanceof Error ? nextError.message : "Unable to load watchlist.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedWatchlistId]);

  function startEditing() {
    if (!payload) {
      return;
    }
    setEditNickname(payload.profile.nickname ?? "");
    setEditBio(payload.profile.bio);
    setSaveError(null);
    setEditing(true);
  }

  useEffect(() => {
    if (!promptForNickname || nicknamePromptOpened || editing || !isOwner || !payload || payload.profile.nickname) {
      return;
    }

    setEditNickname("");
    setEditBio(payload.profile.bio);
    setSaveError(null);
    setEditing(true);
    setNicknamePromptOpened(true);
  }, [editing, isOwner, nicknamePromptOpened, payload, promptForNickname]);

  function cancelEditing() {
    setEditing(false);
    setSaveError(null);
  }

  async function saveProfile() {
    if (!payload) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Not authenticated.");
      }

      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nickname: editNickname.trim() || null,
          bio: editBio.trim(),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to save profile.");
      }

      setPayload((current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                nickname: editNickname.trim() || null,
                bio: editBio.trim(),
              },
            }
          : current,
      );
      setEditing(false);
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFollow() {
    if (!payload || isOwner) {
      return;
    }

    setFollowSaving(true);
    setFollowError(null);
    const wasFollowing = payload.relationship.isFollowing;

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in to follow analysts.");
      }

      const response = await fetch(`/api/users/${userId}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to update follow.");
      }

      setPayload((current) => {
        if (!current) {
          return current;
        }

        const nextIsFollowing = !wasFollowing;
        const followersDelta = nextIsFollowing ? 1 : -1;

        return {
          ...current,
          relationship: {
            isFollowing: nextIsFollowing,
          },
          profile: {
            ...current.profile,
            stats: {
              ...current.profile.stats,
              followersCount: Math.max(0, current.profile.stats.followersCount + followersDelta),
            },
          },
        };
      });
    } catch (nextError) {
      setFollowError(nextError instanceof Error ? nextError.message : "Unable to update follow.");
    } finally {
      setFollowSaving(false);
    }
  }

  async function saveInstitutionDigestSettings(nextSettings: {
    institutionDigestEnabled?: boolean;
    institutionDigestCadence?: InstitutionDigestCadence;
  }) {
    if (!payload || !isOwner) {
      return;
    }

    setDigestSaving(true);
    setDigestError(null);
    setDigestMessage(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Not authenticated.");
      }

      const mergedSettings = {
        institutionDigestEnabled: nextSettings.institutionDigestEnabled ?? payload.profile.settings.institutionDigestEnabled,
        institutionDigestCadence: nextSettings.institutionDigestCadence ?? payload.profile.settings.institutionDigestCadence,
      };
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          settings: mergedSettings,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to save digest settings.");
      }

      setPayload((current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                settings: {
                  ...current.profile.settings,
                  ...mergedSettings,
                },
              },
            }
          : current,
      );
      setDigestMessage("Institution digest settings saved.");
    } catch (nextError) {
      setDigestError(nextError instanceof Error ? nextError.message : "Failed to save digest settings.");
    } finally {
      setDigestSaving(false);
    }
  }

  function absoluteUrl(path: string): string {
    if (typeof window === "undefined") {
      return path;
    }
    return `${window.location.origin}${path}`;
  }

  function badgeEmbedCode(): string {
    const badgeUrl = absoluteUrl(badgePath);
    const profileUrl = absoluteUrl(profilePath);
    const label = payload?.profile.nickname ? `@${payload.profile.nickname}` : preferredName;

    return `<a href="${profileUrl}"><img src="${badgeUrl}" alt="YouAnalyst badge for ${escapeHtmlAttribute(label)}" width="420" height="180" /></a>`;
  }

  async function copyBadgeText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(message);
      window.setTimeout(() => setCopyMessage(null), 2000);
    } catch {
      setCopyMessage("Unable to copy.");
    }
  }

  const selectedWatchlistSummary = payload?.watchlists.find((watchlist) => watchlist.id === selectedWatchlistId) ?? null;
  const selectedWatchlist =
    watchlistState.watchlistId === selectedWatchlistId ? watchlistState.watchlist : null;
  const selectedMetrics = selectedWatchlist?.metrics ?? selectedWatchlistSummary?.metrics ?? null;
  const selectedPredictions =
    selectedWatchlist && status === "LIVE"
      ? selectedWatchlist.livePredictions
      : selectedWatchlist && status === "SETTLED"
        ? selectedWatchlist.settledPredictions
        : selectedWatchlist
          ? [...selectedWatchlist.livePredictions, ...selectedWatchlist.settledPredictions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : [];

  if (loading || !payload) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-slate-300">
        {error ?? "Loading profile..."}
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              {payload.profile.photoURL ? (
                <Image
                  src={payload.profile.photoURL}
                  alt={`${preferredName} avatar`}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full border border-white/15 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-slate-800 text-sm text-cyan-200">
                  {preferredName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">
                  {payload.profile.nickname ? `@${payload.profile.nickname}` : preferredName}
                </h1>
                {payload.profile.aiAnalyst ? (
                  <p className="mt-2">
                    <span className="rounded-full border border-cyan-400/35 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-100">
                      {payload.profile.aiAnalyst.badgeLabel}
                    </span>
                  </p>
                ) : null}
                <nav className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400" aria-label="Profile follow lists">
                  <Link href={`/analysts/${userId}/following`} className="hover:text-cyan-200">
                    {countText(payload.profile.stats.followingCount, "following", "following")}
                  </Link>
                  <span aria-hidden="true">/</span>
                  <Link href={`/analysts/${userId}/followers`} className="hover:text-cyan-200">
                    {countText(payload.profile.stats.followersCount, "follower")}
                  </Link>
                </nav>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-slate-200">
              <p className="text-base">
                <span className="text-slate-400">Score: </span>
                <span className="text-xl font-semibold text-cyan-100">
                  {scoreValueText(payload.profile.stats.totalScore)}
                </span>
              </p>
              <p className="text-sm">
                <span className="text-slate-400">Level: </span>
                <span className="font-semibold text-cyan-100">
                  Level {payload.profile.stats.level} &middot; {analystLevelName(payload.profile.stats.level)}
                </span>
              </p>
              <p className="text-xs">
                <span className="text-slate-400">XP: </span>
                <span className="font-semibold text-cyan-100">
                  {xpProgressText(payload.profile.stats.totalXP, payload.profile.stats.level)}
                </span>
              </p>
              <p className="text-xs">
                <span className="text-slate-400">Settled: </span>
                <span className="font-semibold text-cyan-100">{settledCalls.toLocaleString()}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {isOwner && !editing ? (
              <button
                type="button"
                onClick={startEditing}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200"
              >
                Edit profile
              </button>
            ) : null}
            {!isOwner && !authLoading && user ? (
              <button
                type="button"
                onClick={() => void toggleFollow()}
                disabled={followSaving}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  payload.relationship.isFollowing
                    ? "border border-white/10 text-slate-300 hover:border-rose-400/40 hover:text-rose-200"
                    : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                }`}
              >
                {followSaving ? "Saving..." : payload.relationship.isFollowing ? "Unfollow" : "Follow"}
              </button>
            ) : null}
            {!isOwner && !authLoading && !user ? (
              <Link
                href="/auth"
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Sign in to follow
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
            >
              Share badge
            </button>
          </div>
        </div>
        {followError ? <p className="mt-2 text-xs text-rose-300">{followError}</p> : null}

        {editing ? (
          <div className="mt-3 grid gap-3">
            {promptForNickname && !payload.profile.nickname ? (
              <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                Choose a nickname. This is the name people will see publicly on YouAnalyst.
              </p>
            ) : null}
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="edit-nickname">
                Nickname
              </label>
              <p className="mb-2 text-xs text-slate-500">This is the name people will see publicly on YouAnalyst.</p>
              <input
                id="edit-nickname"
                type="text"
                maxLength={30}
                value={editNickname}
                onChange={(e) => setEditNickname(e.target.value)}
                placeholder="your_handle"
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="edit-bio">
                Bio
              </label>
              <textarea
                id="edit-bio"
                maxLength={500}
                rows={3}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder="Tell others about yourself..."
                className="w-full resize-none rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/50"
              />
            </div>
            {saveError ? <p className="text-xs text-rose-400">{saveError}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveProfile()}
                disabled={saving}
                className="rounded-lg bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="rounded-lg border border-white/10 px-4 py-1.5 text-xs text-slate-300 hover:border-white/25 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-300">
            {payload.profile.bio || "Add a bio to tell others what you analyze"}
          </p>
        )}
        {payload.profile.aiAnalyst ? (
          <p className="mt-3 text-xs leading-6 text-slate-400">
            {payload.profile.aiAnalyst.disclosureLong}
          </p>
        ) : null}
      </section>

      {isOwner ? (
        <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Institution digest</h2>
              <p className="mt-1 text-sm text-slate-300">Activity summaries for institutions you follow.</p>
              {payload.profile.settings.institutionDigestLastSentAt ? (
                <p className="mt-2 text-xs text-slate-500">Last sent {payload.profile.settings.institutionDigestLastSentAt}</p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:min-w-72">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-900/55 px-4 py-3">
                <span>
                  <span className="block text-sm font-semibold text-slate-100">Digest</span>
                  <span className="mt-1 block text-xs text-slate-500">Prepare followed-institution activity summaries.</span>
                </span>
                <input
                  type="checkbox"
                  checked={payload.profile.settings.institutionDigestEnabled}
                  disabled={digestSaving}
                  onChange={(event) => void saveInstitutionDigestSettings({ institutionDigestEnabled: event.target.checked })}
                  className="h-5 w-5 accent-cyan-400"
                />
              </label>
              <label className="grid gap-1 text-xs text-slate-400">
                Cadence
                <select
                  value={payload.profile.settings.institutionDigestCadence}
                  disabled={digestSaving || !payload.profile.settings.institutionDigestEnabled}
                  onChange={(event) => void saveInstitutionDigestSettings({ institutionDigestCadence: event.target.value as InstitutionDigestCadence })}
                  className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring disabled:opacity-60"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              {digestSaving ? <p className="text-xs text-slate-400">Saving digest settings...</p> : null}
              {digestMessage ? <p className="text-xs text-emerald-300">{digestMessage}</p> : null}
              {digestError ? <p className="text-xs text-rose-300">{digestError}</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {payload.profile.aiAnalyst ? (
        <section className="grid gap-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5 md:grid-cols-3">
          <div>
            <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">
              {payload.profile.aiAnalyst.profileSections.coverageUniverseTitle}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {payload.profile.aiAnalyst.coverageTickers.map((ticker) => (
                <span
                  key={ticker}
                  className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-100"
                >
                  {formatTickerSymbol(ticker)}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">
              {payload.profile.aiAnalyst.profileSections.methodologyTitle}
            </h2>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              <p>{payload.profile.aiAnalyst.howItWorks.summary}</p>
              {payload.profile.aiAnalyst.howItWorks.methodology.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
          <div>
            <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">
              {payload.profile.aiAnalyst.profileSections.limitationsTitle}
            </h2>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {payload.profile.aiAnalyst.howItWorks.rules.map((item) => (
                <p key={item}>{item}</p>
              ))}
              {payload.profile.aiAnalyst.howItWorks.limitations.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Watchlists</h2>
            <p className="mt-1 text-sm text-slate-300">Public watchlists and track record for this analyst.</p>
          </div>
          {isOwner ? (
            <Link
              href="/watchlists?tab=mine"
              className="rounded-full border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
            >
              Manage watchlists
            </Link>
          ) : null}
        </div>

        {payload.watchlists.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {payload.watchlists.map((watchlist) => (
                <button
                  key={watchlist.id}
                  type="button"
                  onClick={() => beginWatchlistLoad(watchlist.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    selectedWatchlistId === watchlist.id
                      ? "bg-cyan-500 text-slate-950"
                      : "border border-white/10 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100"
                  }`}
                >
                  {watchlist.name}
                </button>
              ))}
            </div>

            {selectedWatchlistSummary ? (
              <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
                        {selectedWatchlistSummary.name}
                      </h3>
                      <Link
                        href={`/analysts/${userId}/watchlists/${selectedWatchlistSummary.id}`}
                        className="text-xs font-medium text-cyan-300 hover:text-cyan-100"
                      >
                        Open page
                      </Link>
                    </div>
                    {selectedWatchlistSummary.description ? (
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                        {selectedWatchlistSummary.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="inline-flex rounded-full border border-slate-700 bg-slate-800/70 p-1 text-xs">
                    {(["ALL", "LIVE", "SETTLED"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setStatus(option)}
                        className={`rounded-full px-3 py-1.5 transition ${
                          status === option ? "bg-cyan-500 text-slate-950" : "text-slate-200 hover:text-white"
                        }`}
                      >
                        {statusFilterLabel(option)}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedMetrics ? (
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Live return</p>
                      <p className="mt-1 font-semibold text-cyan-100">
                        {watchlistReturnText(selectedMetrics.liveReturn)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Settled return</p>
                      <p className="mt-1 font-semibold text-cyan-100">
                        {watchlistReturnText(selectedMetrics.settledReturn)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Live</p>
                      <p className="mt-1 font-semibold text-slate-100">
                        {selectedMetrics.livePredictionCount.toLocaleString()} predictions
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Settled</p>
                      <p className="mt-1 font-semibold text-slate-100">
                        {selectedMetrics.settledPredictionCount.toLocaleString()} predictions
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
                  {watchlistState.loading && watchlistState.watchlistId === selectedWatchlistId ? (
                    <p className="text-sm text-slate-300">Loading watchlist...</p>
                  ) : watchlistState.error && watchlistState.watchlistId === selectedWatchlistId ? (
                    <p className="text-sm text-rose-300">{watchlistState.error}</p>
                  ) : selectedPredictions.length > 0 ? (
                    <div>
                      {selectedPredictions.map((prediction) => (
                        <ProfileWatchlistPredictionRow key={prediction.id} prediction={prediction} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-300">
                      {status === "LIVE"
                        ? "No live predictions in this watchlist."
                        : status === "SETTLED"
                          ? "No settled predictions in this watchlist."
                          : "No predictions in this watchlist yet."}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
            {isOwner ? "No watchlists yet. Create one to organize your predictions." : "No watchlists yet."}
          </p>
        )}
      </section>

      {shareOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 px-4">
          <div className="w-full max-w-lg rounded-lg border border-cyan-500/25 bg-slate-950 p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Share badge</h2>
                <p className="mt-1 text-sm text-slate-400">Embed your YouAnalyst analyst badge anywhere.</p>
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/25"
              >
                Close
              </button>
            </div>

            <Image
              src={badgePath}
              alt={`YouAnalyst badge for ${preferredName}`}
              width={420}
              height={180}
              className="mt-4 w-full rounded-lg border border-white/10"
            />

            <div className="mt-4 grid gap-3">
              <div>
                <p className="mb-1 text-xs text-slate-400">Badge URL</p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={absoluteUrl(badgePath)}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => void copyBadgeText(absoluteUrl(badgePath), "Badge URL copied.")}
                    className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs text-slate-400">Embed code</p>
                <textarea
                  readOnly
                  rows={3}
                  value={badgeEmbedCode()}
                  className="w-full resize-none rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200"
                />
                <button
                  type="button"
                  onClick={() => void copyBadgeText(badgeEmbedCode(), "Embed code copied.")}
                  className="mt-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                >
                  Copy embed
                </button>
              </div>

              {copyMessage ? <p className="text-xs text-emerald-300">{copyMessage}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
