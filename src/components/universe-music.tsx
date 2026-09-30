"use client";

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocale } from './providers/locale-provider';
import styles from './universe-music.module.css';

const preferenceKey = 'ya-universe-music-muted';
const preferenceEvent = 'universe-music-preference';
let memoryMuted = true;
let useMemoryPreference = false;
function readMuted() {
  if (useMemoryPreference) return memoryMuted;
  try { return localStorage.getItem(preferenceKey) !== 'false'; } catch { return memoryMuted; }
}
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(preferenceEvent, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(preferenceEvent, notify);
  };
}

export function UniverseMusic({ active = true }: { active?: boolean }) {
  const { text } = useLocale();
  const muted = useSyncExternalStore(subscribe, readMuted, () => true);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.35;
    if (!active || muted) { audio.pause(); return; }
    let pending = false;
    const play = (event?: Event) => {
      // The mute control must never briefly start audio on its way to muting it.
      if (event?.target instanceof Element && event.target.closest('[data-universe-music-toggle]')) return;
      if (!audio.paused || pending) return;
      pending = true;
      void audio.play().catch(() => {
        // Autoplay may require a user gesture. The next interaction retries it.
      }).finally(() => { pending = false; });
    };
    play();
    window.addEventListener('click', play);
    window.addEventListener('keydown', play);
    return () => {
      window.removeEventListener('click', play);
      window.removeEventListener('keydown', play);
      audio.pause();
    };
  }, [active, muted]);

  const label = muted ? text('Unmute music', '开启音乐') : text('Mute music', '静音');
  return <>
    <audio ref={audioRef} src="/audio/blisters.mp3" loop preload="none" />
    {active && <button type="button" className={styles.toggle} data-universe-music-toggle
      aria-label={label} title={label} aria-pressed={!muted} onClick={() => {
        memoryMuted = !muted;
        try {
          localStorage.setItem(preferenceKey, String(memoryMuted));
          useMemoryPreference = false;
        } catch { useMemoryPreference = true; }
        window.dispatchEvent(new Event(preferenceEvent));
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z" />
        {muted ? <path d="m16 9 6 6m0-6-6 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}
      </svg>
      <span>{text('Music', '音乐')}</span>
    </button>}
  </>;
}
