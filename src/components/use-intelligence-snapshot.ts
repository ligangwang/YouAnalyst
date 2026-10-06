"use client";

import { useEffect, useRef, useState } from 'react';
import { parseCompanyTheme, type CompanyThemeId } from '@/lib/company-themes/model';
import type { IntelligenceSnapshot } from '@/lib/intelligence/model';
import { useIndustryBrowseParam, updateIndustryBrowse } from './industry-browse-state';

const clearedThemeSelection = { company: '', relationship: '', event: '', q: '', page: '' };

/** Keeps the displayed theme usable until a validated replacement is ready. */
export function useIntelligenceSnapshot(initialSnapshot?: IntelligenceSnapshot, initialTheme = 'ai') {
  const theme = parseCompanyTheme(useIndustryBrowseParam('theme', 'ai', initialTheme));
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshot | null>(initialSnapshot ?? null);
  const themeSnapshots = useRef(new Map<CompanyThemeId, IntelligenceSnapshot>(
    initialSnapshot ? [[parseCompanyTheme(initialSnapshot.theme), initialSnapshot]] : [],
  ));
  const themeIntent = useRef<CompanyThemeId | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let disposed = false, inFlight = false;
    let controller: AbortController | null = null;
    const isCurrentTheme = () => !disposed && parseCompanyTheme(new URLSearchParams(window.location.search).get('theme')) === theme;
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        const response = await fetch(`/api/intelligence?theme=${theme}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: IntelligenceSnapshot = await response.json();
        if ((data.theme ?? 'ai') !== theme || !data.graphVersion || !Array.isArray(data.graph?.nodes) || !Array.isArray(data.events) || !data.session?.startAt) throw new Error();
        if (isCurrentTheme()) {
          const old = themeSnapshots.current.get(theme);
          // Preserve the graph object on unchanged polls so camera tours continue.
          const next = old?.graphVersion === data.graphVersion ? { ...data, graph: old.graph } : data;
          themeSnapshots.current.set(theme, next);
          if (themeIntent.current === theme) {
            themeIntent.current = null;
            updateIndustryBrowse(clearedThemeSelection);
          }
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
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [retry, theme]);

  const changeTheme = (next: CompanyThemeId) => {
    setError('');
    const cached = themeSnapshots.current.get(next), changed = next !== parseCompanyTheme(snapshot?.theme);
    themeIntent.current = changed && !cached ? next : null;
    if (cached) setSnapshot(cached);
    // Keep the visible selection until the new data is ready. Cancelling restores it.
    updateIndustryBrowse({ theme: next === 'ai' ? '' : next, ...(changed && cached ? clearedThemeSelection : {}) });
  };
  const reconnect = () => {
    if (snapshot) setError('');
    setRetry(value => value + 1);
  };

  return { snapshot, theme, error, changeTheme, reconnect };
}
