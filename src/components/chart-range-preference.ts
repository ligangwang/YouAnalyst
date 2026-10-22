"use client";

import { useSyncExternalStore } from 'react';
import { TIMELINE_RANGES, type TimelineRange } from '@/lib/ui/company-timeline';

const storageKey = 'youanalyst.chartRange';
const validRange = (value: string | null): value is string =>
  value !== null && TIMELINE_RANGES.some(range => String(range) === value);

function snapshot() {
  const requested = new URLSearchParams(window.location.search).get('chartRange');
  if (validRange(requested)) return requested;
  try {
    const saved = window.localStorage.getItem(storageKey);
    return validRange(saved) ? saved : '';
  } catch {
    return '';
  }
}

function subscribe(notify: () => void) {
  window.addEventListener('popstate', notify);
  window.addEventListener('industry-browse-changed', notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('industry-browse-changed', notify);
    window.removeEventListener('storage', notify);
  };
}

/** Explicit share links override the saved default without changing it. */
export function useChartRangePreference() {
  return useSyncExternalStore(subscribe, snapshot, () => '');
}

/** Called only for a user's range selection, before updating the chart URL. */
export function rememberChartRange(range: TimelineRange) {
  try {
    window.localStorage.setItem(storageKey, String(range));
  } catch {
    // The URL still retains the current choice when browser storage is blocked.
  }
}
