"use client";

import { useId, useState } from 'react';
import type { TreeLayer } from '@/lib/ui/knowledge-graph/industry-tree';
import { useLocale } from './providers/locale-provider';
import styles from './ai-layer-filters.module.css';

export function AiLayerFilters({layers,selected,onSelect}:{layers:TreeLayer[];selected:string;onSelect:(id:string)=>void}) {
  const {text,chinese}=useLocale();
  const [expanded,setExpanded]=useState<string[]>([]);
  const id=useId();
  return <nav className={styles.layers} aria-label={text('AI layers','AI 产业层级')}>
    {layers.map(layer=>{
      const open=expanded.includes(layer.id),label=chinese?layer.zh:layer.en;
      return <section key={layer.id} className={styles.layer}>
        <div className={styles.heading}>
          <button type="button" aria-pressed={selected===`layer:${layer.id}`} disabled={!layer.companies.length} onClick={()=>onSelect(`layer:${layer.id}`)}><i style={{background:layer.color}}/><span>{label}</span><small>{layer.companies.length}</small></button>
          <button type="button" className={styles.disclosure} disabled={!layer.branches.length} aria-label={text(`${open?'Collapse':'Expand'} ${layer.en}`,`${open?'收起':'展开'}${layer.zh}`)} aria-expanded={open} aria-controls={`${id}-${layer.id}`} onClick={()=>setExpanded(current=>open?current.filter(value=>value!==layer.id):[...current,layer.id])}><span aria-hidden="true">›</span></button>
        </div>
        <div id={`${id}-${layer.id}`} className={styles.branches} hidden={!open}>
          {layer.branches.map(branch=><button type="button" key={branch.id} aria-pressed={selected===`branch:${branch.id}`} onClick={()=>onSelect(`branch:${branch.id}`)}><span>{chinese?branch.zh:branch.en}</span><small>{branch.companies.length}</small></button>)}
        </div>
      </section>;
    })}
  </nav>;
}
