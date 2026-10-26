"use client";

import { UiText } from "@/components/ui-text";
import { useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";

export function ProfilePhotoEditor({ onChanged }: { onChanged: (photoURL: string | null) => void }) {
  const { user, getIdToken, setProfilePhotoURL } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const hasGoogle = user?.providerData.some((provider) => provider.providerId === "google.com");

  async function save(file?: File) {
    if (!user || busy) return;
    setError(null);
    setMessage(null);
    if (file && (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError("Choose a JPEG, PNG, or WebP image under 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Sign in to change your photo.");
      const response = await fetch(`/api/users/${encodeURIComponent(user.uid)}/photo`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": file ? file.type : "application/json" },
        body: file ?? JSON.stringify({ source: "google" }),
      });
      const result = await response.json() as { photoURL: string | null; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to update your photo.");
      setProfilePhotoURL(result.photoURL);
      onChanged(result.photoURL);
      setMessage(file ? "Photo updated. Your custom photo will stay selected when you sign in." : "Using your Google photo. It will refresh when you sign in with Google.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to update your photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 text-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-cyan-200 hover:text-cyan-100">
        <UiText text={"Change photo"} />
      </button>
      {open ? (
        <div className="mt-2 space-y-3 rounded-xl border border-white/10 bg-slate-950/50 p-3" aria-busy={busy}>
          <label className="block text-slate-200">
            <UiText text={"Upload photo"} />
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
              className="mt-2 block w-full max-w-xs text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-200 file:px-3 file:py-2 file:text-slate-950 disabled:opacity-50"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void save(file);
              }} />
          </label>
          <p className="text-xs text-slate-400"><UiText text={"JPEG, PNG, or WebP, up to 5 MB. Photos are cropped to a square and saved immediately."} /></p>
          <button type="button" disabled={busy || !hasGoogle} onClick={() => void save()}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-cyan-200 hover:border-cyan-300/50 disabled:opacity-50">
            <UiText text={"Use Google photo"} />
          </button>
          <p className="text-xs text-slate-400"><UiText text={hasGoogle ? "To fetch a recently changed Google photo, sign out and sign back in with Google first." : "A linked Google account is needed to use a Google photo."} /></p>
          {busy ? <p role="status" className="text-xs text-slate-300"><UiText text={"Saving photo…"} /></p> : null}
          {error ? <p role="alert" className="text-xs text-rose-300"><UiText text={error} /></p> : null}
          {message ? <p role="status" className="text-xs text-cyan-200"><UiText text={message} /></p> : null}
        </div>
      ) : null}
    </div>
  );
}
