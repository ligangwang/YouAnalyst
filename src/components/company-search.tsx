"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SearchSuggestion } from './ticker-search-input';
import { useLocale } from './providers/locale-provider';
import styles from './company-search.module.css';
import { companyPageUrl } from '@/lib/market-companies/routes';
import { localizedPath } from '@/lib/i18n/urls';
import { createPortal } from 'react-dom';

export function CompanySearch({ enabled = true, onSelect, owner = 'global', typeToSearch = true }: { enabled?: boolean; onSelect?: (item: SearchSuggestion) => void; owner?: 'global' | 'workspace' | 'directory' | 'chart'; typeToSearch?: boolean }) {
  const { text, locale } = useLocale();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; items: SearchSuggestion[] } | null>(null);
  const [active, setActive] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId(), composing = useRef(false);
  const searched = query.normalize('NFKC').trim().replace(/^\$/, '');
  const items = results?.query === searched ? results.items : [];
  function close() { setOpen(false); if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); }
  function show(initial = '') {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    flushSync(() => { setQuery(initial); setResults(null); setActive(0); setError(false); setBusy(false); setOpen(true); });
    input.current?.focus({ preventScroll: true });
  }
  function preferredTrigger() {
    const full = [...document.querySelectorAll<HTMLElement>('[data-chart-size="full"]')].filter(element => element.getClientRects().length && !element.closest('[inert]')).at(-1);
    return full?.querySelector<HTMLButtonElement>('[data-company-search-trigger]')
      ?? document.querySelector<HTMLButtonElement>('[data-company-search-owner="workspace"] [data-company-search-trigger], [data-company-search-owner="directory"] [data-company-search-trigger]');
  }
  useEffect(() => {
    if (!enabled || !typeToSearch) return;
    const key = (event: KeyboardEvent) => {
      if (open || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat || document.querySelector('[data-company-search]')) return;
      const preferred = preferredTrigger();
      if (preferred && preferred !== trigger.current) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable],[role="textbox"],[role="dialog"],[data-event-window]')) {
        // The fullscreen chart itself is a dialog; its controls still accept text-to-search.
        const target = event.target;
        if (target.closest('input,textarea,select,[contenteditable],[role="textbox"],[data-event-window]') || target.closest('[role="dialog"]')?.getAttribute('data-chart-size') !== 'full') return;
      }
      if (event.isComposing || event.key === 'Process' || event.keyCode === 229) { show(); return; }
      if (event.key.length === 1 && /[\p{L}\p{N}$*&'’().:\-]/u.test(event.key)) { event.preventDefault(); event.stopPropagation(); show(event.key); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [enabled, open, typeToSearch]);
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
  const choose = (item: SearchSuggestion) => { close(); if (onSelect) onSelect(item); else location.assign(localizedPath(companyPageUrl(item.market === 'GLOBAL' ? item.id : item.symbol, item.market, item.slug), locale)); };
  if (!enabled) return null;
  const dialog = open && <div className={styles.backdrop} data-company-search data-stock-search onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-label={text('Search company', '搜索公司')} onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const focusable = [...panel.current!.querySelectorAll<HTMLElement>('input,button')];
          if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
        }
      }}>
        <header><strong>{text('Search company', '搜索公司')}</strong><button type="button" aria-label={text('Close company search', '关闭公司搜索')} onClick={close}>×</button></header>
        <input ref={input} value={query} maxLength={120} role="combobox" aria-label={text('Search company', '搜索公司')} aria-autocomplete="list" aria-expanded={items.length > 0} aria-controls={listId} aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          placeholder={text('Search company', '搜索公司')}
          onChange={event => { setQuery(event.target.value); setActive(0); setError(false); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); if (items.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length); }
            if (event.key === 'Enter' && items[active]) { event.preventDefault(); event.stopPropagation(); choose(items[active]); }
          }} />
        <div id={listId} role="listbox" aria-label={text('Matching companies', '匹配公司')}>{items.map((item, index) => <button id={`${listId}-${index}`} key={item.id} type="button" role="option" aria-selected={active === index} onPointerMove={() => setActive(index)} onClick={() => choose(item)}><strong>{item.name}</strong><span>{item.symbol} · {item.market ?? ''} {item.exchange ?? ''}</span></button>)}</div>
        {error ? <p role="alert">{text('Search unavailable. Try again.', '搜索暂时不可用，请重试。')}</p> : busy && searched ? <p role="status">{text('Searching…', '搜索中…')}</p> : searched && results?.query === searched && !items.length ? <p role="status">{text('No matching companies.', '没有匹配的公司。')}</p> : null}
      </div>
    </div>;
  return <span data-company-search-owner={owner}>
    <button ref={trigger} data-company-search-trigger type="button" className={styles.trigger} aria-label={text('Search company', '搜索公司')} title={typeToSearch ? text('Type to search', '输入即可搜索') : text('Search company', '搜索公司')} disabled={!enabled} onClick={() => {
      const preferred = owner === 'global' ? preferredTrigger() : null;
      if (preferred && preferred !== trigger.current) preferred.click(); else show();
    }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><span>{text('Search company', '搜索公司')}</span></button>
    {owner === 'global' && dialog ? createPortal(dialog, document.body) : dialog}
  </span>;
}
