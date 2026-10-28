"use client";
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SearchSuggestion } from './ticker-search-input';
import { useLocale } from './providers/locale-provider';
import styles from './company-search.module.css';
import { companyPageUrl } from '@/lib/market-companies/routes';
import { localizedPath } from '@/lib/ui/i18n/urls';
import { createPortal } from 'react-dom';
import {useOptionalAuth} from '@/components/providers/auth-provider';
import {useCompanySearchActivity} from './company-search-activity';

export function CompanySearch({ enabled = true, onSelect, owner = 'global', typeToSearch = true, iconOnly = false, inline = false, clearOnSelect = false }: { enabled?: boolean; onSelect?: (item: SearchSuggestion) => void; owner?: 'global' | 'workspace' | 'directory' | 'chart'; typeToSearch?: boolean; iconOnly?: boolean; inline?: boolean; clearOnSelect?: boolean }) {
  const { text, locale } = useLocale();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  useCompanySearchActivity(enabled && open);
  const [results, setResults] = useState<{ query: string; items: SearchSuggestion[] } | null>(null);
  const [featuredCount,setFeaturedCount]=useState<number|null>(null);
  const auth=useOptionalAuth();
  const [requests,setRequests]=useState<Record<string,NonNullable<SearchSuggestion['supportState']>>>({});
  const [pending,setPending]=useState<string|null>(null),[requestError,setRequestError]=useState<string|null>(null);
  const requestLock=useRef(false);
  const [active, setActive] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId(), composing = useRef(false);
  const queuedQuery = useRef<string | null>(null), destination = useRef({onSelect, locale});
  const searched = query.normalize('NFKC').trim().replace(/^\$/, '');
  const searchPending = searched.length > 0 && results?.query !== searched;
  useEffect(() => { destination.current = {onSelect, locale}; }, [onSelect, locale]);
  useEffect(()=>{
    if(!enabled||(!inline&&!open)||featuredCount!==null||searchPending)return;
    const controller=new AbortController();
    // Coverage is secondary: do not start the graph-backed count while the user
    // is opening search or waiting for their first suggestions.
    const timer=setTimeout(()=>{void fetch('/api/tickers/search?scope=covered&limit=1',{signal:controller.signal,cache:'no-store'})
      .then(async response=>{if(!response.ok)return;const data=await response.json();if(!controller.signal.aborted&&Number.isSafeInteger(data.total)&&data.total>=0)setFeaturedCount(data.total);})
      .catch(()=>{});},1000);
    return()=>{clearTimeout(timer);controller.abort();};
  },[enabled,inline,open,featuredCount,searchPending]);
  const items = results?.query === searched ? results.items : [];
  const close = useCallback(() => { queuedQuery.current = null; composing.current = false; setOpen(false); if (!inline && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); }, [inline]);
  const choose = useCallback((item: SearchSuggestion) => { close(); if (clearOnSelect) { setQuery(''); setResults(null); } const current = destination.current; if (current.onSelect && item.supportState === 'SUPPORTED' && (owner!=='workspace'||item.hasThemes!==false)) current.onSelect(item); else location.assign(localizedPath(companyPageUrl(item.companyId??(item.market === 'GLOBAL' ? item.id : item.symbol), item.market, item.slug), current.locale)); }, [close, clearOnSelect,owner]);
  const show = useCallback((initial = '') => {
    queuedQuery.current = null; composing.current = false;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    flushSync(() => { setQuery(initial); setResults(null); setActive(0); setError(false); setBusy(false); setOpen(true); });
    input.current?.focus({ preventScroll: !inline });
  }, [inline]);
  function preferredTrigger() {
    const full = [...document.querySelectorAll<HTMLElement>('[data-chart-size="full"]')].filter(element => element.getClientRects().length && !element.closest('[inert]')).at(-1);
    return full?.querySelector<HTMLButtonElement | HTMLInputElement>('[data-company-search-trigger]')
      ?? document.querySelector<HTMLButtonElement | HTMLInputElement>('[data-company-search-owner="workspace"] [data-company-search-trigger], [data-company-search-owner="directory"] [data-company-search-trigger]');
  }
  useEffect(() => {
    if (!enabled || !typeToSearch) return;
    const key = (event: KeyboardEvent) => {
      if (open || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat || document.querySelector('[data-company-search]')) return;
      if ((inline ? input.current : trigger.current)?.closest('[inert]')) return;
      const preferred = preferredTrigger();
      if (preferred && preferred !== (inline ? input.current : trigger.current)) return;
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
  }, [enabled, open, typeToSearch, inline, show]);
  useEffect(() => {
    if (!open || !searched) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError(false);
      void fetch('/api/tickers/search?' + new URLSearchParams({ q: searched, limit: '8', scope: 'directory' }), { signal: controller.signal })
        .then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); if (!controller.signal.aborted) { const matches: SearchSuggestion[] = data.items ?? []; setResults({ query: searched, items: matches }); setActive(0); if (queuedQuery.current === searched) { queuedQuery.current = null; if (matches[0]) choose(matches[0]); } } })
        .catch(() => { if (!controller.signal.aborted) { setError(true); setResults(null); } })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, searched, choose]);
  useEffect(() => {
    if (!inline || !open) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [inline, open, close]);
  if (!enabled) return null;
  const field = <input ref={input} data-company-search-trigger={inline || undefined} value={query} maxLength={120} role="combobox" aria-label={text('Search company', '搜索公司')} aria-autocomplete="list" aria-expanded={open && items.length > 0} aria-controls={listId} aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          placeholder={text('Search company', '搜索公司')}
          onFocus={() => { if (inline) setOpen(true); }}
          onChange={event => { if (inline) setOpen(true); queuedQuery.current = null; setQuery(event.target.value); setActive(0); setError(false); setRequestError(null); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={event => {
            if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (inline && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); if (inline) setOpen(true); if (items.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length); }
            if (event.key === 'Enter' && searched) { event.preventDefault(); event.stopPropagation(); if (items[active]) choose({...items[active],supportState:items[active].supportState==='ELIGIBLE'?(requests[items[active].id]??items[active].supportState):items[active].supportState}); else queuedQuery.current = searched; }
          }} />;
  const supportLabel=(state:SearchSuggestion['supportState'])=>state==='QUEUED'?text('Onboarding Queued','等待入驻'):state==='PROCESSING'?text('Onboarding…','入驻中…'):state==='BLOCKED'?text('Onboarding Needs Attention','入驻需要处理'):state==='CIK_UNMATCHED'?text('CIK not matched','CIK 未匹配'):null;
  async function requestSupport(item:SearchSuggestion){
    if(requestLock.current)return;
    if(!auth?.user||auth.user.isAnonymous){
      const next=localizedPath(companyPageUrl(item.market==='GLOBAL'?item.id:item.symbol,item.market,item.slug),locale);
      location.assign(localizedPath('/auth',locale)+'?'+new URLSearchParams({next}));return;
    }
    requestLock.current=true;setPending(item.id);setRequestError(null);
    try{
      const token=await auth.getIdToken();if(!token)throw Error('auth');
      const response=await fetch('/api/instrument-onboarding/requests',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({instrumentId:item.instrumentId,listingId:item.id})});
      if(response.status===401||response.status===403)throw Error('auth');
      if(!response.ok)throw Error('request');
      const data=await response.json();
      if(!['QUEUED','PROCESSING','BLOCKED','SUPPORTED'].includes(data.status))throw Error('request');
      setRequests(current=>({...current,[item.id]:data.status}));
    }catch(error){setRequestError(error instanceof Error&&error.message==='auth'?text('Sign in to request full support.','请登录后申请完整支持。'):text('Unable to request full support. Try again.','暂时无法申请完整支持，请重试。'));}
    finally{requestLock.current=false;setPending(null);}
  }
  const suggestions = <>
    <div id={listId} role="listbox" aria-label={text('Matching companies', '匹配公司')}>{items.map((result, index) => {
      const item={...result,supportState:result.supportState==='ELIGIBLE'?(requests[result.id]??result.supportState):result.supportState};
      const label=supportLabel(item.supportState);
      return <div className={styles.resultRow} key={item.id}>
        <button id={`${listId}-${index}`} type="button" role="option" aria-selected={active === index} onPointerMove={() => setActive(index)} onClick={() => choose(item)}><strong>{item.name}</strong><span>{item.symbol} · {item.market ?? ''} {item.exchange ?? ''}</span>{label&&<span className={styles.supportStatus} aria-live="polite">{label}</span>}</button>
        {item.supportState==='ELIGIBLE'&&<button className={styles.supportAction} type="button" disabled={pending!==null||auth?.loading} onClick={()=>void requestSupport(item)}>{pending===item.id?text('Requesting…','申请中…'):auth?.user&&!auth.user.isAnonymous?text('Request Full Support','申请完整支持'):text('Sign in to request full support','登录以申请完整支持')}</button>}
      </div>;
    })}</div>
    {requestError&&<p role="alert">{requestError}</p>}
    {error ? <p role="alert">{text('Search unavailable. Try again.', '搜索暂时不可用，请重试。')}</p> : busy && searched ? <p role="status">{text('Searching…', '搜索中…')}</p> : searched && results?.query === searched && !items.length ? <p role="status">{text('No companies match your search.', '未找到匹配的公司。')}</p> : null}
  </>;
  const formattedCount=featuredCount===null?null:new Intl.NumberFormat(locale).format(featuredCount);
  const coverageHint = <p className={styles.coverageHint}>{formattedCount===null?text('Stocks featured','精选股票'):text(`${formattedCount} ${featuredCount===1?'stock':'stocks'} featured`,`已精选 ${formattedCount} 只股票`)}</p>;
  if (inline) return <div className={styles.embedded} data-company-search-owner={owner}>
    <div ref={panel} className={`${styles.panel} ${styles.inline}`} data-company-search={open || undefined} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
      <div className={styles.searchField}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>{field}</div>
      {coverageHint}
      {open && searched && <div className={styles.suggestions}>{suggestions}</div>}
    </div>
  </div>;
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
        {field}
        {coverageHint}
        {suggestions}
      </div>
    </div>;
  return <span data-company-search-owner={owner}>
    <button ref={trigger} data-company-search-trigger type="button" className={`${styles.trigger} ${iconOnly ? styles.iconOnly : ''}`} aria-label={text('Search company', '搜索公司')} title={!iconOnly && typeToSearch ? text('Type to search', '输入即可搜索') : text('Search company', '搜索公司')} disabled={!enabled} onClick={() => {
      const preferred = owner === 'global' ? preferredTrigger() : null;
      if (preferred instanceof HTMLInputElement) preferred.focus(); else if (preferred && preferred !== trigger.current) preferred.click(); else show();
    }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><span>{text('Search company', '搜索公司')}</span></button>
    {owner === 'global' && dialog ? createPortal(dialog, document.body) : dialog}
  </span>;
}
