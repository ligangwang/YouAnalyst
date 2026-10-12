"use client";

import { useEffect, useRef, useState } from 'react';
import { useLocale } from './providers/locale-provider';
import styles from './chart-size-controls.module.css';

export function useChartSize() {
  const [size, setSize] = useState<'compact' | 'half' | 'full'>('compact');
  const root = useRef<HTMLElement>(null);
  const [viewportHeight, setViewportHeight] = useState(800);
  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (size !== 'full' || !root.current) return;
    const element = root.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const siblings: {element:HTMLElement; inert:boolean}[] = [];
    for (let branch: HTMLElement | null = element; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) if (sibling !== branch && sibling instanceof HTMLElement) {
        siblings.push({element:sibling,inert:sibling.inert}); sibling.inert = true;
      }
    }
    document.body.style.overflow = 'hidden';
    element.focus();
    const keyboard = (event: KeyboardEvent) => {
      // A fullscreen price chart inside this view owns its keyboard interaction.
      if (element.querySelector('[data-chart-size="full"]')) return;
      if (event.key === 'Escape' && !element.querySelector('[data-event-window]')) { event.preventDefault(); event.stopPropagation(); setSize('compact'); }
      if (event.key === 'Tab') {
        const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      document.body.style.overflow = previousOverflow;
      siblings.forEach(sibling => { sibling.element.inert = sibling.inert; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [size]);
  return {size,setSize,root,viewportHeight};
}

export function ChartSizeControls({size,onChange,label}: {size:'compact'|'half'|'full';onChange:(size:'compact'|'half'|'full')=>void;label?:string}) {
  const {text} = useLocale();
  return <div className={styles.controls} role="group" aria-label={label??text('Chart size','图表大小')}>
    <button type="button" aria-pressed={size==='half'} onClick={()=>onChange('half')}>{text('Half screen','半屏')}</button>
    <button type="button" aria-pressed={size==='full'} onClick={()=>onChange('full')}>{text('Full screen','全屏')}</button>
    {size!=='compact'&&<button type="button" onClick={()=>onChange('compact')}>{text('Restore layout','恢复布局')}</button>}
  </div>;
}
