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
      if (element.querySelector('[data-chart-size="full"],[data-stock-search],[data-indicator-study][open]')) return;
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

function SizeIcon({size}:{size:'compact'|'half'|'full'}) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {size==='half'?<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/><path d="M4 4h16v7H4z" fill="currentColor" fillOpacity=".2" stroke="none"/></>:<path d={size==='full'?'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5':'M3 8h5V3M21 8h-5V3M16 21v-5h5M3 16h5v5'}/>}
  </svg>;
}
export function ChartSizeControls({size,onChange,label,iconOnly=false}: {size:'compact'|'half'|'full';onChange:(size:'compact'|'half'|'full')=>void;label?:string;iconOnly?:boolean}) {
  const {text} = useLocale();
  return <div className={`${styles.controls} ${iconOnly?styles.iconControls:''}`} role="group" aria-label={label??text('Chart size','图表大小')}>
    <button type="button" aria-label={text('Half screen','半屏')} title={text('Half screen','半屏')} aria-pressed={size==='half'} onClick={()=>onChange('half')}>{iconOnly?<SizeIcon size="half"/>:text('Half screen','半屏')}</button>
    <button type="button" aria-label={text('Full screen','全屏')} title={text('Full screen','全屏')} aria-pressed={size==='full'} onClick={()=>onChange('full')}>{iconOnly?<SizeIcon size="full"/>:text('Full screen','全屏')}</button>
    {size!=='compact'&&<button type="button" aria-label={text('Restore layout','恢复布局')} title={text('Restore layout','恢复布局')} onClick={()=>onChange('compact')}>{iconOnly?<SizeIcon size="compact"/>:text('Restore layout','恢复布局')}</button>}
  </div>;
}
