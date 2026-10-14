"use client";

import { useLocale } from "./providers/locale-provider";
import { useEffect, useRef } from "react";
import { useMarket } from './providers/preferences-context';

export function MarketTicker() {
  const { chinese } = useLocale();
  const { theme } = useMarket();
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
      ],
      colorTheme: theme, isTransparent: true, showSymbolLogo: false,
      displayMode: "regular", locale: chinese ? "zh_CN" : "en",
    });
    script.onerror = () => {
      widget.textContent = chinese ? "市场行情暂不可用" : "Market quotes temporarily unavailable";
    };
    const observer = new MutationObserver(() => {
      const frame = mount.querySelector("iframe");
      if (frame) {
        frame.title = chinese ? "TradingView 美国指数差价合约行情" : "TradingView US index CFDs";
        observer.disconnect();
      }
    });
    observer.observe(mount, { childList: true, subtree: true });
    mount.appendChild(script);
    container.appendChild(mount);
    return () => { observer.disconnect(); script.onerror = null; mount.remove(); };
  }, [chinese, theme]);

  return (
    <section className="border-b border-white/5 bg-slate-950/50" aria-label={chinese ? "市场指数" : "Market indices"}>
      <div className="mx-auto flex min-h-12 max-w-6xl items-center px-2 sm:px-4">
        <div ref={host} className="min-h-[46px] min-w-0 flex-1 text-xs text-slate-400 [&_iframe]:block" />
        <a className="ml-0.5 inline-flex shrink-0 items-center self-stretch border-l border-white/10 px-1 text-[8px] leading-none font-normal whitespace-nowrap text-slate-400 hover:text-slate-200" href="https://www.tradingview.com/markets/" target="_blank" rel="noopener noreferrer" aria-label={chinese ? "行情来自 TradingView" : "Quotes by TradingView"}>
          TradingView
        </a>
      </div>
    </section>
  );
}
