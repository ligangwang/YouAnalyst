"use client";

import { UiText } from "@/components/ui-text";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchSuggestion, TickerSearchInput } from "@/components/ticker-search-input";
import { chinaCompanyId, companyPageUrl } from "@/lib/market-companies/routes";

function normalizeTicker(value: string): string {
  return value.trim().replace(/^\$/, "").toUpperCase();
}

function isValidTicker(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(value);
}

export function CompanySearchCard() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState<SearchSuggestion | null>(null);
  const normalizedTicker = normalizeTicker(query);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const selectedTicker = selectedResult?.kind !== "institution" ? selectedResult : null;


    if (selectedTicker?.symbol) {
      setError(null);
      startTransition(() => {
        router.push(companyPageUrl(selectedTicker.market === "GLOBAL" ? selectedTicker.id : selectedTicker.symbol, selectedTicker.market));
      });
      return;
    }

    if (!normalizedTicker) {
      setError("Enter a ticker or company name.");
      return;
    }

    if (chinaCompanyId(normalizedTicker)) {
      setError(null);
      startTransition(() => {
        router.push(companyPageUrl(normalizedTicker, "CN_A"));
      });
      return;
    }

    if (!isValidTicker(normalizedTicker)) {
      setError("Choose a company from search, or enter a valid ticker.");
      return;
    }

    setError(null);
    startTransition(() => {
      router.push(`/ticker/${encodeURIComponent(normalizedTicker)}`);
    });
  }

  return (
    <form
      onSubmit={submitSearch}
      className="mt-6 rounded-2xl border border-cyan-400/20 bg-slate-950/70 p-3 shadow-[0_12px_44px_rgba(8,47,73,0.22)] sm:p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <TickerSearchInput
          companySearch
          value={query}
          onChange={(value) => {
            setQuery(value);
            setSelectedResult(null);
            setError(null);
          }}
          onSelectSuggestion={setSelectedResult}
          error={error}
          hideLabel
          label="Company or ticker"
          showHelperText={false}
        />
        <button
          type="submit"
          disabled={isPending}
          className="h-11 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? <UiText text={"Opening..."} /> : <UiText text={"Go"} />}
        </button>
      </div>
    </form>
  );
}
