"use client";

import { useLocale } from "./providers/locale-provider";
import { useEffect, useRef } from "react";
import { INDUSTRY_STARTERS } from "@/lib/industry-graph/catalog";

// Explicit US listings for the AI map's starter companies; never guess an
// exchange for a newly added company or accidentally select a foreign listing.
const AI_EXCHANGES: Record<string, "NASDAQ" | "NYSE"> = {
  TSM: "NYSE", AMAT: "NASDAQ", LRCX: "NASDAQ", INTC: "NASDAQ",
  NVDA: "NASDAQ", AMD: "NASDAQ", MU: "NASDAQ", SNDK: "NASDAQ",
  WDC: "NASDAQ", AVGO: "NASDAQ", ANET: "NYSE", MSFT: "NASDAQ",
  AMZN: "NASDAQ", GOOGL: "NASDAQ", META: "NASDAQ", VRT: "NYSE",
  EQIX: "NASDAQ", CEG: "NASDAQ", AAPL: "NASDAQ", QCOM: "NASDAQ",
};
const AI_SYMBOLS = INDUSTRY_STARTERS.flatMap(({ ticker }) => {
  const exchange = AI_EXCHANGES[ticker];
  return exchange ? [{ proName: `${exchange}:${ticker}`, title: ticker }] : [];
});

export function MarketTicker() {
  const { chinese } = useLocale();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    // The official embed reads its configuration and mount point from this script.
    const mount = document.createElement("div");
    mount.className = "tradingview-widget-container";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    mount.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.async = true;
    script.textContent = JSON.stringify({
      symbols: [
        { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
        { proName: "FOREXCOM:NSXUSD", title: "Nasdaq 100" },
        { proName: "FOREXCOM:DJI", title: "Dow 30" },
        ...AI_SYMBOLS,
      ],
      colorTheme: "dark", isTransparent: true, showSymbolLogo: false,
      displayMode: "regular", locale: chinese ? "zh_CN" : "en",
    });
    script.onerror = () => {
      widget.textContent = chinese ? "市场行情暂不可用" : "Market quotes temporarily unavailable";
    };
    const observer = new MutationObserver(() => {
      const frame = mount.querySelector("iframe");
      if (frame) {
        frame.title = chinese ? "TradingView 美国指数差价合约与 AI 股票行情" : "TradingView US index CFDs and AI stock quotes";
        observer.disconnect();
      }
    });
    observer.observe(mount, { childList: true, subtree: true });
    mount.appendChild(script);
    container.appendChild(mount);
    return () => { observer.disconnect(); script.onerror = null; mount.remove(); };
  }, [chinese]);

  return (
    <section className="border-b border-white/5 bg-slate-950/50" aria-label={chinese ? "市场指数与 AI 股票" : "Market indices and AI stocks"}>
      <div className="mx-auto flex min-h-12 max-w-6xl items-center px-2 sm:px-4">
        <div ref={host} className="min-h-[46px] min-w-0 flex-1 text-xs text-slate-400 [&_iframe]:block" />
        <a className="ml-0.5 inline-flex shrink-0 items-center self-stretch border-l border-white/10 px-1 text-[8px] leading-none font-normal whitespace-nowrap text-slate-400 hover:text-slate-200" href="https://www.tradingview.com/markets/" target="_blank" rel="noopener noreferrer" aria-label={chinese ? "行情来自 TradingView" : "Quotes by TradingView"}>
          TradingView
        </a>
      </div>
    </section>
  );
}
