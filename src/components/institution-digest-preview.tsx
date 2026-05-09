"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import type { InstitutionDigestPreview } from "@/lib/securities/institution-follows";

type PreviewResponse = InstitutionDigestPreview & {
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

export function InstitutionDigestPreviewPanel() {
  const { getIdToken } = useAuth();
  const [preview, setPreview] = useState<InstitutionDigestPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Sign in to preview your digest.");
      }

      const response = await fetch("/api/institutions/follows/digest/preview?limit=12", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as PreviewResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to preview institution digest.");
      }

      setPreview(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to preview institution digest.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/55 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-[var(--font-sora)] text-base font-semibold text-cyan-100">Digest preview</h3>
          <p className="mt-1 text-xs text-slate-500">Preview candidate activity before delivery is connected.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={loading}
          className="w-fit rounded-xl border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {loading ? "Loading..." : "Preview"}
        </button>
      </div>

      {error ? <p className="mt-3 text-xs text-rose-300">{error}</p> : null}

      {preview ? (
        <div className="mt-4">
          <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
            <p>
              Delivery
              <span className="mt-1 block font-semibold text-slate-100">{preview.wouldSend ? "Ready" : "Would skip"}</span>
            </p>
            <p>
              Cadence
              <span className="mt-1 block font-semibold text-slate-100">{preview.preferences.cadence}</span>
            </p>
            <p>
              Generated
              <span className="mt-1 block font-semibold text-slate-100">{preview.generatedAt}</span>
            </p>
          </div>

          {preview.items.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {preview.items.map((item) => (
                <article key={item.positionKey} className="rounded-lg border border-white/10 bg-slate-950/55 p-3">
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
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-white/20 p-3 text-sm text-slate-300">
              No new followed-institution activity would be included right now.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
