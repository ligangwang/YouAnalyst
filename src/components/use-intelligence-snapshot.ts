"use client";

import { useEffect, useRef, useState } from 'react';
import { parseCompanyTheme, type CompanyThemeId } from '@/lib/company-themes/model';
import type { IntelligenceSnapshot } from '@/lib/intelligence/model';
import { useIndustryBrowseParam, updateIndustryBrowse } from './industry-browse-state';

const clearedThemeSelection = { company: '', feedCompany: '', relationship: '', event: '', q: '', page: '' };
const feedCompany = (params: URLSearchParams) => (params.get('feedCompany') || (!params.get('event') && !params.get('relationship') ? params.get('company') : '') || '').toUpperCase();
const feedScope = (company:string,query:string,region:string) => JSON.stringify([company,company?'':query.normalize('NFKC').trim(),company?'':region==='US'||region==='CN_A'?region:'']);

/** Keeps the displayed theme usable until a validated replacement is ready. */
export function useIntelligenceSnapshot(initialSnapshot?: IntelligenceSnapshot, initialTheme = 'ai') {
  const theme = parseCompanyTheme(useIndustryBrowseParam('theme', 'ai', initialTheme));
  const explicitCompany = useIndustryBrowseParam('feedCompany');
  const selectedCompany = useIndustryBrowseParam('company');
  const selectedEvent = useIndustryBrowseParam('event');
  const selectedRelationship = useIndustryBrowseParam('relationship');
  const searchQuery = useIndustryBrowseParam('q');
  const searchRegion = useIndustryBrowseParam('region');
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshot | null>(initialSnapshot ?? null);
  const bootstrapRequired = useRef(!initialSnapshot || Boolean(initialSnapshot.eventsPending));
  const themeSnapshots = useRef(new Map<CompanyThemeId, IntelligenceSnapshot>(
    initialSnapshot ? [[parseCompanyTheme(initialSnapshot.theme), initialSnapshot]] : [],
  ));
  const themeIntent = useRef<CompanyThemeId | null>(null);
  const snapshotScope = useRef(feedScope('','',''));
  const company = themeIntent.current === theme ? '' : (explicitCompany || (!selectedEvent && !selectedRelationship ? selectedCompany : '')).toUpperCase();
  const query = themeIntent.current === theme || company ? '' : searchQuery.normalize('NFKC').trim();
  const region = themeIntent.current === theme || company ? '' : searchRegion==='US'||searchRegion==='CN_A'?searchRegion:'';
  const scope = feedScope(company,query,region);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let disposed = false, inFlight = false;
    let controller: AbortController | null = null;
    const universeController = new AbortController();
    const isCurrentTheme = () => {
      const params = new URLSearchParams(window.location.search);
      return !disposed && parseCompanyTheme(params.get('theme')) === theme && (themeIntent.current === theme || feedScope(feedCompany(params),params.get('q')??'',params.get('region')??'') === scope);
    };
    // Start the directory independently. A late bootstrap must never replace
    // a complete feed or a response belonging to another theme/company.
    if (bootstrapRequired.current) {
      const universeTimeout = setTimeout(() => universeController.abort(), 15_000);
      void fetch(`/api/intelligence?theme=${theme}&section=universe`, {cache:'no-store',signal:universeController.signal})
        .then(async response => {
          if (!response.ok) return;
          const data:IntelligenceSnapshot = await response.json();
          if ((data.theme??'ai')!==theme || !data.graphVersion || !Array.isArray(data.graph?.nodes) || !Array.isArray(data.events) || !data.session?.startAt || !isCurrentTheme()) return;
          const cached=themeSnapshots.current.get(theme);
          if(!cached||cached.eventsPending)themeSnapshots.current.set(theme,data);
          setSnapshot(current => current && !current.eventsPending ? current : data);
        })
        .catch(() => {}) // The full request owns the retry/error state.
        .finally(() => clearTimeout(universeTimeout));
    }
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        const response = await fetch(`/api/intelligence?theme=${theme}${company ? `&company=${encodeURIComponent(company)}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}${region?`&region=${encodeURIComponent(region)}`:''}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: IntelligenceSnapshot = await response.json();
        if ((data.theme ?? 'ai') !== theme || !data.graphVersion || !Array.isArray(data.graph?.nodes) || !Array.isArray(data.events) || !data.session?.startAt) throw new Error();
        if (isCurrentTheme()) {
          const old = themeSnapshots.current.get(theme);
          // Preserve the graph object on unchanged polls so camera tours continue.
          const next = old?.graphVersion === data.graphVersion ? { ...data, graph: old.graph } : data;
          if (!company&&!query&&!region) themeSnapshots.current.set(theme, next);
          if (themeIntent.current === theme) {
            themeIntent.current = null;
            updateIndustryBrowse(clearedThemeSelection);
          }
          snapshotScope.current = scope;
          bootstrapRequired.current = false;
          setSnapshot(next);
          setError('');
        }
      } catch {
        if (isCurrentTheme()) setError('Unable to refresh investment intelligence.');
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const onVisible = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      disposed = true;
      controller?.abort();
      universeController.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [retry, theme, company, query, region, scope]);

  const changeTheme = (next: CompanyThemeId) => {
    setError('');
    const cached = themeSnapshots.current.get(next), changed = next !== parseCompanyTheme(snapshot?.theme);
    themeIntent.current = changed && !cached ? next : null;
    if (cached) { snapshotScope.current = feedScope('','',''); setSnapshot(cached); }
    // Keep the visible selection until the new data is ready. Cancelling restores it.
    updateIndustryBrowse({ theme: next === 'ai' ? '' : next, ...(changed && cached ? clearedThemeSelection : {}) });
  };
  const reconnect = () => {
    if (snapshot) setError('');
    setRetry(value => value + 1);
  };

  // Clearing or switching a company immediately restores the theme feed while
  // its fresh company request is pending; stale scoped responses cannot win.
  const displayed = snapshotScope.current === scope ? snapshot : themeSnapshots.current.get(parseCompanyTheme(snapshot?.theme)) ?? snapshot;
  const searching = Boolean((query||region)&&snapshotScope.current!==scope);
  return { snapshot: searching&&displayed?{...displayed,eventsPending:true}:displayed, theme, error, changeTheme, reconnect };
}
