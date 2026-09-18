"use client";

import { useEffect, useRef, useState } from 'react';
import { useLocale } from './providers/locale-provider';
import { tradingViewSymbol } from '@/lib/tradingview';

function QuoteEmbed({ symbol, chinese }: { symbol: string; chinese: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let active = true;
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js';
    script.async = true;
    script.textContent = JSON.stringify({ symbol, width: '100%', colorTheme: 'dark', isTransparent: true, locale: chinese ? 'zh_CN' : 'en' });
    script.onerror = () => { if (active) setFailed(true); };
    container.replaceChildren(widget, script);
    return () => { active = false; container.replaceChildren(); };
  }, [symbol, chinese]);
  return <>
    <div ref={host} className="tradingview-widget-container min-h-[126px]" />
    {failed && <p className="text-sm text-slate-400">{chinese ? '行情暂不可用，请通过下方链接查看。' : 'Quote unavailable. Open TradingView below.'}</p>}
  </>;
}

export function CompanyQuote({ ticker, exchange }: { ticker: string; exchange?: string | null }) {
  const { chinese, text } = useLocale();
  const symbol = tradingViewSymbol(ticker, exchange);
  if (!symbol) return null;
  const label = ticker.includes(':') ? ticker.split(':')[1] : ticker;
  const href = `https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`;
  return <section aria-label={text('Stock quote', '股票行情')} className="mt-5 w-full max-w-sm">
    <QuoteEmbed key={`${symbol}:${chinese}`} symbol={symbol} chinese={chinese} />
    <p className="tradingview-widget-copyright mt-1 text-xs leading-5 text-slate-400">
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-200 hover:underline">{text(`${label} quotes by TradingView`, `${label} 行情由 TradingView 提供`)}</a>
      {' · '}{text('Quotes may be delayed.', '行情可能存在延迟。')}
    </p>
  </section>;
}
