"use client";

import { useSyncExternalStore } from 'react';

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener('industry-browse-changed', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('industry-browse-changed', notify);
  };
};

// Keep browsing state on the history entry so returning from a profile restores it.
export function useIndustryBrowseParam(key: string, fallback = '', serverFallback = fallback) {
  return useSyncExternalStore(subscribe,
    () => new URLSearchParams(window.location.search).get(key) ?? fallback,
    () => serverFallback);
}

export function updateIndustryBrowse(values: Record<string, string>, resetPage = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (resetPage) url.searchParams.delete('page');
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event('industry-browse-changed'));
}
