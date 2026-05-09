"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { formatTickerSymbol } from "@/components/prediction-ui";

export type TickerSuggestion = {
  id: string;
  kind?: "ticker";
  symbol: string;
  name: string;
  exchange: string | null;
  micCode: string | null;
  type: string | null;
};

export type InstitutionSuggestion = {
  id: string;
  kind: "institution";
  cik: string;
  name: string;
  latestReportDate: string | null;
  latestQuarter: string | null;
};

export type SearchSuggestion = TickerSuggestion | InstitutionSuggestion;

type TickerSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSelectSuggestion?: (item: SearchSuggestion) => void;
  error?: string | null;
  hideLabel?: boolean;
  label?: string;
  showHelperText?: boolean;
};

type SearchResponse = {
  items?: SearchSuggestion[];
  error?: string;
};

function normalizeTypedTicker(value: string): string {
  return value.trimStart().replace(/^\$/, "").toUpperCase();
}

function suggestionMeta(item: TickerSuggestion): string {
  return [item.exchange, item.type].filter(Boolean).join(" · ");
}

function resultMeta(item: SearchSuggestion): string {
  if (item.kind === "institution") {
    return ["Institution", `CIK ${item.cik}`, item.latestQuarter].filter(Boolean).join(" / ");
  }

  return suggestionMeta(item);
}

export function TickerSearchInput({
  value,
  onChange,
  onSelectSuggestion,
  error,
  hideLabel = false,
  label = "Ticker",
  showHelperText = true,
}: TickerSearchInputProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = value.trim().replace(/^\$/, "");

  useEffect(() => {
    if (query.length === 0) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setSearchError(null);

      void fetch(`/api/tickers/search?q=${encodeURIComponent(query)}&limit=8`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as SearchResponse;
          if (!response.ok) {
            throw new Error(payload.error ?? "Unable to search tickers.");
          }
          setSuggestions(payload.items ?? []);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch((nextError) => {
          if (controller.signal.aborted) {
            return;
          }
          setSuggestions([]);
          setOpen(true);
          setActiveIndex(-1);
          setSearchError(nextError instanceof Error ? nextError.message : "Unable to search tickers.");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function selectSuggestion(item: SearchSuggestion) {
    onChange(item.kind === "institution" ? item.name : item.symbol);
    onSelectSuggestion?.(item);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0) {
      setOpen(true);
      setActiveIndex(0);
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && open && activeIndex >= 0 && suggestions[activeIndex]) {
      selectSuggestion(suggestions[activeIndex]);
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const showPanel = open && query.length > 0;
  const helperText = searchError
    ? searchError
    : loading
      ? "Searching..."
      : "Type a company, ticker, institution, or CIK.";

  return (
    <div ref={containerRef} className="relative grid gap-2">
      <label className={hideLabel ? "sr-only" : "text-sm text-slate-200"} htmlFor="ticker-search">
        {label}
      </label>
      <input
        id="ticker-search"
        value={value}
        onChange={(event) => {
          const nextValue = normalizeTypedTicker(event.target.value);
          onChange(nextValue);
          if (nextValue.trim().length === 0) {
            setSuggestions([]);
            setOpen(false);
            setLoading(false);
            setSearchError(null);
            setActiveIndex(-1);
            return;
          }
          setOpen(true);
        }}
        onFocus={() => {
          if (query.length > 0) {
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search company, ticker, or institution"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        className={`rounded-xl border bg-slate-950/60 px-3 py-2 text-sm text-white outline-none ring-cyan-400/40 focus:ring ${
          error ? "border-rose-400/50" : "border-white/15"
        }`}
      />
      {showHelperText || searchError || loading ? (
        <p className={`text-xs ${searchError ? "text-rose-300" : "text-slate-400"}`}>{helperText}</p>
      ) : null}
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}

      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-slate-950 shadow-xl"
        >
          {suggestions.map((item, index) => (
            <button
              key={item.id}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectSuggestion(item)}
              className={`grid w-full gap-0.5 px-3 py-2 text-left text-sm ${
                activeIndex === index ? "bg-cyan-500/15" : "hover:bg-white/5"
              }`}
            >
              <span className="font-semibold text-cyan-100">
                {item.kind === "institution" ? (
                  <>
                    {item.name} <span className="font-normal text-slate-300">Institution</span>
                  </>
                ) : (
                  <>
                    {formatTickerSymbol(item.symbol)} <span className="font-normal text-slate-300">{item.name}</span>
                  </>
                )}
              </span>
              {resultMeta(item) ? <span className="text-xs text-slate-500">{resultMeta(item)}</span> : null}
            </button>
          ))}

          {!loading && !searchError && suggestions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No matching company or institution found.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
