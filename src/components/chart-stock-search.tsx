"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SearchSuggestion } from './ticker-search-input';
import { useLocale } from './providers/locale-provider';
import styles from './chart-stock-search.module.css';

export function ChartStockSearch({ enabled, onSelect }: { enabled: boolean; onSelect: (item: SearchSuggestion) => void }) {
  const { text } = useLocale();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; items: SearchSuggestion[] } | null>(null);
  const [active, setActive] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const listId = useId(), composing = useRef(false);
  const searched = query.normalize('NFKC').trim().replace(/^\$/, '');
  const items = results?.query === searched ? results.items : [];
  function close() { setOpen(false); if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); }
  useEffect(() => {
    if (!enabled) return;
    const show = (initial = '') => {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      flushSync(() => { setQuery(initial); setResults(null); setActive(0); setError(false); setBusy(false); setOpen(true); });
      input.current?.focus({ preventScroll: true });
    };
    const key = (event: KeyboardEvent) => {
      if (open || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],[data-stock-search],[data-event-window]')) return;
      // Focus a real input before the IME starts; never consume composition keys.
      if (event.isComposing || event.key === 'Process' || event.keyCode === 229) { show(); return; }
      if (event.key.length === 1 && /[\p{L}\p{N}$*]/u.test(event.key)) { event.preventDefault(); event.stopPropagation(); show(event.key); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [enabled, open]);
  useEffect(() => {
    if (!open || !searched) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError(false);
      void fetch('/api/tickers/search?' + new URLSearchParams({ q: searched, limit: '8', scope: 'all' }), { signal: controller.signal })
        .then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); if (!controller.signal.aborted) { setResults({ query: searched, items: data.items ?? [] }); setActive(0); } })
        .catch(() => { if (!controller.signal.aborted) { setError(true); setResults(null); } })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, searched]);
  const choose = (item: SearchSuggestion) => { onSelect(item); close(); };
  if (!enabled) return null;
  return <>
    <button type="button" onClick={() => { previousFocus.current = document.activeElement as HTMLElement; setQuery(''); setResults(null); setError(false); setOpen(true); requestAnimationFrame(() => input.current?.focus()); }}>{text('Find stock · type to search', '查找股票 · 直接输入')}</button>
    {open && <div className={styles.backdrop} data-stock-search onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-label={text('Find stock', '查找股票')} onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const focusable = [...panel.current!.querySelectorAll<HTMLElement>('input,button')];
          if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
        }
      }}>
        <header><strong>{text('Find stock', '查找股票')}</strong><button type="button" aria-label={text('Close stock search', '关闭股票查找')} onClick={close}>×</button></header>
        <input ref={input} value={query} maxLength={120} role="combobox" aria-label={text('Stock name, pinyin or code', '股票名称、拼音或代码')} aria-autocomplete="list" aria-expanded={items.length > 0} aria-controls={listId} aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          placeholder={text('Chinese / pinyin / English / ticker', '中文／拼音／英文／股票代码')}
          onChange={event => { setQuery(event.target.value); setActive(0); setError(false); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); if (items.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length); }
            if (event.key === 'Enter' && items[active]) { event.preventDefault(); event.stopPropagation(); choose(items[active]); }
          }} />
        <p>{text('↑↓ select · Enter open · Esc close', '↑↓ 选择 · 回车打开 · Esc 关闭')}</p>
        <div id={listId} role="listbox" aria-label={text('Matching stocks', '匹配股票')}>{items.map((item, index) => <button id={`${listId}-${index}`} key={item.id} type="button" role="option" aria-selected={active === index} onPointerMove={() => setActive(index)} onClick={() => choose(item)}><strong>{item.name}</strong><span>{item.symbol} · {item.market ?? ''} {item.exchange ?? ''}</span></button>)}</div>
        {error ? <p role="alert">{text('Search unavailable. Try again.', '搜索暂时不可用，请重试。')}</p> : busy && searched ? <p role="status">{text('Searching…', '搜索中…')}</p> : searched && results?.query === searched && !items.length ? <p role="status">{text('No matching stocks.', '没有匹配的股票。')}</p> : null}
      </div>
    </div>}
  </>;
}
