"use client";

import { UiText } from "@/components/ui-text";

import { FormEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchSuggestion, TickerSearchInput } from "@/components/ticker-search-input";
import { useLocale } from "@/components/providers/locale-provider";
import { localizedPath } from "@/lib/i18n/urls";
import { chinaCompanyId, companyPageUrl } from "@/lib/market-companies/routes";

function normalizeTicker(value: string): string {
  return value.trim().replace(/^\$/, "").toUpperCase();
}

function isValidTicker(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(value);
}

function suggestionUrl(item: SearchSuggestion): string {
  return companyPageUrl(item.market === "GLOBAL" ? item.id : item.symbol, item.market);
}

// Resolve typed text to the search's best match; the API ranks exact tickers and names first.
async function bestMatch(query: string): Promise<SearchSuggestion | null> {
  const response = await fetch(`/api/tickers/search?q=${encodeURIComponent(query)}&limit=1&scope=all`);
  if (!response.ok) throw new Error("Unable to search companies.");
  const payload = (await response.json().catch(() => ({}))) as { items?: SearchSuggestion[] };
  return payload.items?.[0] ?? null;
}

export function CompanySearchCard() {
  const router = useRouter();
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const normalizedTicker = normalizeTicker(query);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [isPending, startTransition] = useTransition();
  const results = useRef<{ query: string; items: SearchSuggestion[] } | null>(null);

  function open(path: string) {
    setError(null);
    startTransition(() => {
      // Link straight to the localized page instead of relying on a proxy redirect.
      router.push(localizedPath(path, locale));
    });
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!normalizedTicker) {
      setError("Enter a ticker or company name.");
      return;
    }

    const typed = query.trim().replace(/^\$/, "");
    const loaded = results.current?.query === typed ? results.current.items[0] : undefined;
    if (loaded) {
      open(suggestionUrl(loaded));
      return;
    }

    setResolving(true);
    let match: SearchSuggestion | null = null;
    try {
      match = await bestMatch(typed);
    } catch {
      // Fall back to the typed ticker below.
    } finally {
      setResolving(false);
    }
    if (match) {
      open(suggestionUrl(match));
      return;
    }

    if (chinaCompanyId(normalizedTicker)) {
      open(companyPageUrl(normalizedTicker, "CN_A"));
      return;
    }

    if (!isValidTicker(normalizedTicker)) {
      setError("No matching company found.");
      return;
    }

    open(`/ticker/${encodeURIComponent(normalizedTicker)}`);
  }

  const busy = isPending || resolving;

  return (
    <form
      onSubmit={submitSearch}
      className="mt-6 rounded-2xl border border-cyan-400/20 bg-slate-950/70 p-3 shadow-[0_12px_44px_rgba(8,47,73,0.22)] sm:p-4"
    >
      {/* Go sits beside the input at every width, so the suggestion list never covers it. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:gap-3">
        <TickerSearchInput
          companySearch
          value={query}
          onChange={(value) => {
            setQuery(value);
            setError(null);
          }}
          onResults={(searched, items) => {
            results.current = { query: searched, items };
          }}
          onSelectSuggestion={(item) => open(suggestionUrl(item))}
          error={error}
          hideLabel
          label="Company or ticker"
          showHelperText={false}
        />
        <button
          type="submit"
          disabled={busy}
          className="h-11 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <UiText text={"Opening..."} /> : <UiText text={"Go"} />}
        </button>
      </div>
    </form>
  );
}
