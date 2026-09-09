"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers/auth-provider";
import { predictionSignInHref } from "@/lib/auth-continuation";
import { trackEvent } from "@/lib/analytics";

export function CompanyDirectionActions({ ticker, entryPoint = "company" }: { ticker: string; entryPoint?: "company" | "evidence" }) {
  const { user, loading } = useAuth();
  return <div className="flex flex-wrap gap-2" role="group" aria-label={`Track ${ticker}`}>
    {(["UP", "DOWN"] as const).map(direction => {
      const label = direction === "UP" ? "Bullish" : "Bearish";
      const destination = `/predictions/new?${new URLSearchParams({ ticker, direction })}`;
      return <Link key={direction} href={!loading && !user ? `${predictionSignInHref(ticker, "", direction)}&mode=register` : destination}
        onClick={() => trackEvent("graph_predict_click", { ticker, action: direction, entry_point: entryPoint })}
        className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold ${direction === "UP" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20" : "border-rose-400/50 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20"}`}>
        {label}
      </Link>;
    })}
  </div>;
}
