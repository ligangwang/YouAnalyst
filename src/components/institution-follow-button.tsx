"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

type FollowResponse = {
  isFollowing?: boolean;
  error?: string;
};

export function InstitutionFollowButton({ cik, name }: { cik: string; name: string }) {
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    let cancelled = false;

    void getIdToken()
      .then(async (token) => {
        if (!token) {
          throw new Error("Sign in to follow institutions.");
        }

        const response = await fetch(`/api/institutions/${encodeURIComponent(cik)}/follow`, {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as FollowResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load follow status.");
        }

        if (!cancelled) {
          setIsFollowing(Boolean(payload.isFollowing));
          setLoadedForUser(user.uid);
          setError(null);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load follow status.");
          setLoadedForUser(user.uid);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, cik, getIdToken, user]);

  async function toggleFollow() {
    if (!user || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    const wasFollowing = isFollowing;

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in to follow institutions.");
      }

      const response = await fetch(`/api/institutions/${encodeURIComponent(cik)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as FollowResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update follow.");
      }

      setIsFollowing(!wasFollowing);
      setLoadedForUser(user.uid);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update follow.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <button
        type="button"
        disabled
        className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-400"
      >
        Loading...
      </button>
    );
  }

  if (!user) {
    return (
      <Link
        href="/auth"
        className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
      >
        Sign in to follow
      </Link>
    );
  }

  const isLoaded = loadedForUser === user.uid;

  return (
    <div className="grid justify-items-end gap-2">
      <button
        type="button"
        onClick={() => void toggleFollow()}
        disabled={saving || !isLoaded}
        aria-label={`${isFollowing ? "Unfollow" : "Follow"} ${name}`}
        className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
          isFollowing
            ? "border border-white/10 text-slate-200 hover:border-rose-400/40 hover:text-rose-200"
            : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
        }`}
      >
        {saving ? "Saving..." : !isLoaded ? "Loading..." : isFollowing ? "Following" : "Follow"}
      </button>
      {error ? <p className="max-w-56 text-right text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
