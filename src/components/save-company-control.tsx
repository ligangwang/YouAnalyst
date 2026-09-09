"use client";

import Link from "next/link";
import { useSavedMapCompanies } from "./use-saved-map-companies";
import { mapSignInHref } from "@/lib/industry-graph/saved-companies";
import { trackEvent } from "@/lib/analytics";

export function SaveCompanyControl({ ticker }: { ticker: string }) {
  const saved = useSavedMapCompanies();
  if (!saved.authLoading && !saved.signedIn) return <Link href={mapSignInHref(ticker)} className="underline underline-offset-4"
    onClick={() => trackEvent("graph_save_intent", { ticker, action: "sign_in", entry_point: "company" })}>Create account to save {ticker}</Link>;
  return <div>
    <button type="button" disabled={!saved.ready || saved.busy} className="rounded-lg border border-cyan-400/40 px-4 py-2 disabled:opacity-50"
      onClick={() => void saved.toggle(ticker)}>
      {saved.authLoading || (!saved.ready && !saved.failed) ? "Loading saved companies…" : saved.busy ? "Saving…" : saved.tickers.includes(ticker) ? `${ticker} saved · Remove` : `Save ${ticker}`}
    </button>
    {saved.failed ? <button type="button" onClick={saved.retry} className="ml-3 underline">Retry saved companies</button> : null}
    {saved.message ? <p role="status" className="mt-2 text-sm font-normal text-slate-300">{saved.message}</p> : null}
  </div>;
}
