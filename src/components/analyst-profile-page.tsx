"use client";
import { TrackRecordPanel } from "./track-record-panel";
import { DisplayPreferencesPanel } from "./display-preferences";

import { MyPredictionsPage } from "./my-predictions-page";
import { UiText, useUiText } from "@/components/ui-text";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProfilePhotoEditor } from "@/components/profile-photo-editor";
import { useAuth } from "@/components/providers/auth-provider";
import { formatTickerSymbol } from "@/components/prediction-ui";
import { analystLevelName } from "@/lib/predictions/analytics";
import { SHOW_ANALYST_LEVELS } from "@/lib/community";

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
    };
  };
  relationship: {
    isFollowing: boolean;
  };
};

function scoreValueText(score: number): string {
  return `${Math.round(score)}`;
}

function xpProgressText(totalXP: number, level: number): string {
  return `${Math.round(totalXP).toLocaleString()} / ${(100 * Math.max(1, level) ** 2).toLocaleString()}`;
}

function countText(count: number, singular: string, plural = `${singular}s`): string {
  const rounded = Math.max(0, Math.round(count));
  return `${rounded.toLocaleString()} ${rounded === 1 ? singular : plural}`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function AnalystProfilePage({
  userId,
  promptForNickname = false,
}: {
  userId: string;
  promptForNickname?: boolean;
}) {
  const ui = useUiText();
  const { user, loading: authLoading, getIdToken, profilePhotoURL } = useAuth();
  const isOwner = Boolean(user && user.uid === userId);
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
  const [shareOpen, setShareOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
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

  if (loading || !payload) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-slate-300">
        {error ?? <UiText text={"Loading profile..."} />}
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8">
      {isOwner ? <DisplayPreferencesPanel /> : null}
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              {(isOwner ? profilePhotoURL : payload.profile.photoURL) ? (
                <Image
                  src={(isOwner ? profilePhotoURL : payload.profile.photoURL)!}
                  alt={ui(`${preferredName} avatar`)}
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
                      {<UiText text={payload.profile.aiAnalyst.badgeLabel} />}
                    </span>
                  </p>
                ) : null}
                <nav className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400" aria-label={ui("Profile follow lists")}>
                  <Link href={`/analysts/${userId}/following`} className="hover:text-cyan-200">
                    {<UiText text={countText(payload.profile.stats.followingCount, "following", "following")} />}
                  </Link>
                  <span aria-hidden="true">/</span>
                  <Link href={`/analysts/${userId}/followers`} className="hover:text-cyan-200">
                    {<UiText text={countText(payload.profile.stats.followersCount, "follower")} />}
                  </Link>
                </nav>
              </div>
            </div>
            {isOwner ? <ProfilePhotoEditor onChanged={(photoURL) => setPayload((current) => current ? { ...current, profile: { ...current.profile, photoURL } } : current)} /> : null}
            <div className="mt-4 grid gap-2 text-slate-200">
              <p className="text-base">
                <span className="text-slate-400"><UiText text={"Score: "} /></span>
                <span className="text-xl font-semibold text-cyan-100">
                  {scoreValueText(payload.profile.stats.totalScore)}
                </span>
              </p>
              {SHOW_ANALYST_LEVELS ? <>
              <p className="text-sm">
                <span className="text-slate-400"><UiText text={"Level: "} /></span>
                <span className="font-semibold text-cyan-100"><UiText text={"Level "} />{payload.profile.stats.level}<UiText text={" &middot; "} />{<UiText text={analystLevelName(payload.profile.stats.level)} />}
                </span>
              </p>
              <p className="text-xs">
                <span className="text-slate-400"><UiText text={"XP: "} /></span>
                <span className="font-semibold text-cyan-100">
                  {xpProgressText(payload.profile.stats.totalXP, payload.profile.stats.level)}
                </span>
              </p>
              </> : null}
              <p className="text-xs">
                <span className="text-slate-400"><UiText text={"Settled: "} /></span>
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
              ><UiText text={"Edit profile"} /></button>
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
                {followSaving ? <UiText text={"Saving..."} /> : payload.relationship.isFollowing ? <UiText text={"Unfollow"} /> : <UiText text={"Follow"} />}
              </button>
            ) : null}
            {!isOwner && !authLoading && !user ? (
              <Link
                href="/auth"
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
              ><UiText text={"Sign in to follow"} /></Link>
            ) : null}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="rounded-lg border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
            ><UiText text={"Share badge"} /></button>
          </div>
        </div>
        {followError ? <p className="mt-2 text-xs text-rose-300">{<UiText text={followError} />}</p> : null}

        {editing ? (
          <div className="mt-3 grid gap-3">
            {promptForNickname && !payload.profile.nickname ? (
              <p className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100"><UiText text={"Choose a nickname. This is the name people will see publicly on YouAnalyst."} /></p>
            ) : null}
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="edit-nickname"><UiText text={"Nickname"} /></label>
              <p className="mb-2 text-xs text-slate-500"><UiText text={"This is the name people will see publicly on YouAnalyst."} /></p>
              <input
                id="edit-nickname"
                type="text"
                maxLength={30}
                value={editNickname}
                onChange={(e) => setEditNickname(e.target.value)}
                placeholder={ui("your_handle")}
                className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400" htmlFor="edit-bio"><UiText text={"Bio"} /></label>
              <textarea
                id="edit-bio"
                maxLength={500}
                rows={3}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder={ui("Tell others about yourself...")}
                className="w-full resize-none rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500/50"
              />
            </div>
            {saveError ? <p className="text-xs text-rose-400">{<UiText text={saveError} />}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveProfile()}
                disabled={saving}
                className="rounded-lg bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {saving ? <UiText text={"Saving..."} /> : <UiText text={"Save"} />}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="rounded-lg border border-white/10 px-4 py-1.5 text-xs text-slate-300 hover:border-white/25 disabled:opacity-50"
              ><UiText text={"Cancel"} /></button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-300">
            {payload.profile.bio || <UiText text={"Add a bio to tell others what you analyze"} />}
          </p>
        )}
        {payload.profile.aiAnalyst ? (
          <p className="mt-3 text-xs leading-6 text-slate-400">
            {<UiText text={payload.profile.aiAnalyst.disclosureLong} />}
          </p>
        ) : null}
      </section>

      {payload.profile.aiAnalyst ? (
        <section className="grid gap-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5 md:grid-cols-3">
          <div>
            <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">
              {<UiText text={payload.profile.aiAnalyst.profileSections.coverageUniverseTitle} />}
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
              {<UiText text={payload.profile.aiAnalyst.profileSections.methodologyTitle} />}
            </h2>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              <p>{<UiText text={payload.profile.aiAnalyst.howItWorks.summary} />}</p>
              {payload.profile.aiAnalyst.howItWorks.methodology.map((item) => (
                <p key={item}><UiText text={item} /></p>
              ))}
            </div>
          </div>
          <div>
            <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">
              {<UiText text={payload.profile.aiAnalyst.profileSections.limitationsTitle} />}
            </h2>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {payload.profile.aiAnalyst.howItWorks.rules.map((item) => (
                <p key={item}><UiText text={item} /></p>
              ))}
              {payload.profile.aiAnalyst.howItWorks.limitations.map((item) => (
                <p key={item}><UiText text={item} /></p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <TrackRecordPanel userId={userId} />
      <MyPredictionsPage ownerId={userId} embedded />
      {shareOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 px-4">
          <div className="w-full max-w-lg rounded-lg border border-cyan-500/25 bg-slate-950 p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Share badge"} /></h2>
                <p className="mt-1 text-sm text-slate-400"><UiText text={"Embed your YouAnalyst analyst badge anywhere."} /></p>
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/25"
              ><UiText text={"Close"} /></button>
            </div>

            <Image
              src={badgePath}
              alt={ui(`YouAnalyst badge for ${preferredName}`)}
              width={420}
              height={180}
              className="mt-4 w-full rounded-lg border border-white/10"
            />

            <div className="mt-4 grid gap-3">
              <div>
                <p className="mb-1 text-xs text-slate-400"><UiText text={"Badge URL"} /></p>
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
                  ><UiText text={"Copy"} /></button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs text-slate-400"><UiText text={"Embed code"} /></p>
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
                ><UiText text={"Copy embed"} /></button>
              </div>

              {copyMessage ? <p className="text-xs text-emerald-300">{<UiText text={copyMessage} />}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
