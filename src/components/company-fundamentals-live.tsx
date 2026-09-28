"use client";

import { useEffect, useState } from "react";
import type { CompanyFundamentals } from "@/lib/fundamentals/model";
import { CompanyFundamentalsView } from "./company-fundamentals";

// Initial cached content is still server-rendered for crawlers. Brief polling lets
// a first visitor see newly completed work without waiting for another navigation.
export function CompanyFundamentalsLive({ ticker, initialData }: { ticker: string; initialData: CompanyFundamentals | null }) {
  const [data, setData] = useState(initialData);
  useEffect(() => {
    if (initialData && !initialData.stale) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, attempts = 0;
    const poll = async () => {
      if (controller.signal.aborted || ++attempts > 12) return;
      try {
        if (!document.hidden) {
          const response = await fetch(`/api/company-fundamentals?ticker=${encodeURIComponent(ticker)}&view=company`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), cache: "no-store",
          });
          if (response.ok) {
            const payload = await response.json();
            if (payload.data && !controller.signal.aborted) {
              setData(payload.data);
              if (!payload.data.stale) return;
            }
          }
        }
      } catch { /* Keep the last usable snapshot during transient failures. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [ticker, initialData]);
  return <CompanyFundamentalsView data={data} />;
}
