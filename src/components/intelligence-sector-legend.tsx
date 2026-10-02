"use client";
import { UiText } from "./ui-text";
import { useLocale } from './providers/locale-provider';

import { useState } from 'react';
import { GRAPH_SECTORS } from '@/lib/knowledge-graph/sectors';
import styles from './intelligence-sector-legend.module.css';

export function IntelligenceSectorLegend() {
  const { chinese } = useLocale();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  return <div className={styles.legend} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onKeyDown={event => {
    if (event.key === 'Escape') { setPinned(false); setHovered(false); }
  }}>
    <button type="button" aria-label="Sector color legend" aria-expanded={open} onClick={() => { setPinned(value => !value); setHovered(false); }} onBlur={() => { setPinned(false); setHovered(false); }}><UiText text={"Sectors"}/>{' '}<span aria-hidden="true">{open ? '▴' : '▾'}</span></button>
    {open && <div className={styles.items}>{GRAPH_SECTORS.map(sector => <span key={sector.id}><i style={{ background: sector.color }} />{chinese ? sector.zh : sector.en}</span>)}</div>}
  </div>;
}
