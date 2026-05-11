"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { InstitutionalManagerSummary } from "@/lib/securities/institutional-data";

type Holding = InstitutionalManagerSummary["holdings"][number];
type HoldingSort = "value" | "shares" | "change" | "ticker";
type HoldingStatus = "ALL" | "CHANGED" | "NEW" | "INCREASED" | "REDUCED" | "SOLD_OUT" | "UNCHANGED" | "CURRENT";

const INITIAL_VISIBLE = 25;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "new";
  }

  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent",
  }).format(value)}`;
}

function changeTone(status: string | null): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

function filingUrl(managerCik: string, accessionNumber: string): string {
  const cik = String(Number(managerCik));
  const accessionPath = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${accessionNumber}-index.html`;
}

function statusForFilter(holding: Holding): HoldingStatus {
  return (holding.changeStatus ?? "CURRENT") as HoldingStatus;
}

function matchesStatus(holding: Holding, status: HoldingStatus): boolean {
  if (status === "ALL") {
    return true;
  }

  if (status === "CHANGED") {
    return Boolean(holding.changeStatus && holding.changeStatus !== "UNCHANGED");
  }

  return statusForFilter(holding) === status;
}

function matchesQuery(holding: Holding, query: string): boolean {
  const normalized = query.trim().toLowerCase().replace(/^\$/, "");
  if (!normalized) {
    return true;
  }

  return (
    holding.ticker?.toLowerCase().includes(normalized) ||
    holding.nameOfIssuer.toLowerCase().includes(normalized) ||
    holding.cusip.toLowerCase().includes(normalized)
  ) === true;
}

function sortHoldings(holdings: Holding[], sort: HoldingSort): Holding[] {
  return [...holdings].sort((left, right) => {
    if (sort === "shares") {
      return right.shares - left.shares;
    }
    if (sort === "change") {
      return Math.abs(right.valueChangeUsd ?? 0) - Math.abs(left.valueChangeUsd ?? 0);
    }
    if (sort === "ticker") {
      return (left.ticker ?? left.nameOfIssuer).localeCompare(right.ticker ?? right.nameOfIssuer);
    }
    return right.valueUsd - left.valueUsd;
  });
}

export function InstitutionDetailHoldings({ holdings }: { holdings: Holding[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<HoldingStatus>("ALL");
  const [sort, setSort] = useState<HoldingSort>("value");
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const filteredHoldings = useMemo(() => (
    sortHoldings(
      holdings.filter((holding) => (
        matchesQuery(holding, query) &&
        matchesStatus(holding, status)
      )),
      sort,
    )
  ), [holdings, query, sort, status]);

  return (
    <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem_11rem] lg:items-end">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Latest 13F holdings</h2>
          <p className="mt-1 text-sm text-slate-400">
            Top reported positions by market value. 13F filings are delayed and may not reflect current holdings.
          </p>
        </div>
        <label className="grid gap-1 text-xs text-slate-400">
          Search holdings
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisible(INITIAL_VISIBLE);
            }}
            placeholder="Ticker, issuer, CUSIP"
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as HoldingSort)}
            className="rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring"
          >
            <option value="value">Value</option>
            <option value="shares">Shares</option>
            <option value="change">Value change</option>
            <option value="ticker">Ticker</option>
          </select>
        </label>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {(["ALL", "CHANGED", "CURRENT", "NEW", "INCREASED", "REDUCED", "SOLD_OUT", "UNCHANGED"] as HoldingStatus[]).map((nextStatus) => (
          <button
            key={nextStatus}
            type="button"
            onClick={() => {
              setStatus(nextStatus);
              setVisible(INITIAL_VISIBLE);
            }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              status === nextStatus ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-300 hover:border-cyan-300/60"
            }`}
          >
            {nextStatus === "ALL" ? "All" : nextStatus.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-3 pr-3">Ticker</th>
              <th className="py-3 pr-3">Issuer</th>
              <th className="py-3 pr-3 text-right">Value</th>
              <th className="py-3 pr-3 text-right">Shares</th>
              <th className="py-3 pr-3">Change</th>
              <th className="py-3 pr-3 text-right">Value change</th>
              <th className="py-3">Report</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {filteredHoldings.slice(0, visible).map((holding) => (
              <tr key={holding.positionKey} className="text-slate-200">
                <td className="py-3 pr-3 font-semibold text-cyan-100">
                  {holding.ticker ? (
                    <Link href={`/ticker/${holding.ticker}`} className="hover:text-cyan-300">
                      {holding.ticker}
                    </Link>
                  ) : (
                    "Unmapped"
                  )}
                </td>
                <td className="py-3 pr-3">
                  {holding.nameOfIssuer}
                  <p className="mt-1 text-xs text-slate-500">{holding.cusip}</p>
                </td>
                <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(holding.valueUsd)}</td>
                <td className="py-3 pr-3 text-right tabular-nums">{formatNumber(holding.shares)}</td>
                <td className="py-3 pr-3">
                  <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(holding.changeStatus)}`}>
                    {holding.changeStatus ?? "CURRENT"} {holding.changeStatus ? formatPercent(holding.percentChange) : ""}
                  </span>
                </td>
                <td className="py-3 pr-3 text-right tabular-nums">
                  {holding.valueChangeUsd === null ? "Unknown" : formatSignedCurrency(holding.valueChangeUsd)}
                </td>
                <td className="py-3 text-slate-400">
                  {holding.reportDate}
                  <a
                    href={filingUrl(holding.managerCik, holding.accessionNumber)}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-cyan-300 hover:text-cyan-100"
                  >
                    SEC filing
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredHoldings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
          No holdings match the current filters.
        </p>
      ) : null}

      {visible < filteredHoldings.length ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setVisible((value) => value + INITIAL_VISIBLE)}
            className="rounded-xl border border-cyan-400/35 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15"
          >
            Show more holdings
          </button>
        </div>
      ) : null}
    </section>
  );
}
