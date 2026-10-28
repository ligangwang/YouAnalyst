"use client";

import {useId, useLayoutEffect, useSyncExternalStore} from 'react';

const searches = new Set<string>();
const listeners = new Set<() => void>();
export const isCompanySearchActive = () => searches.size > 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const serverSnapshot = () => false;

/** Publish before paint so a late-loading graph cannot compete with typing. */
export function useCompanySearchActivity(active: boolean) {
  const id = useId();
  useLayoutEffect(() => {
    if (!active) return;
    searches.add(id);
    listeners.forEach(listener => listener());
    return () => {
      searches.delete(id);
      listeners.forEach(listener => listener());
    };
  }, [active, id]);
}

export const useCompanySearchActive = () => useSyncExternalStore(subscribe, isCompanySearchActive, serverSnapshot);
