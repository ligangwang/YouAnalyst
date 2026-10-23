"use client";
import { catalogThemes, themeFamilies } from '@/lib/company-themes/catalog-model';
import { useThemeCatalog } from './use-theme-catalog';
import { type CompanyThemeId } from '@/lib/company-themes/model';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-center-views.module.css';

export function IntelligenceThemeSelector({theme,onChange,count,compact=false}:{theme:CompanyThemeId;onChange:(theme:CompanyThemeId)=>void;count?:number;compact?:boolean}) {
  const {chinese}=useLocale();
  const { nodes, themeName } = useThemeCatalog();
  return <label className={`${styles.themeSelector} ${compact?styles.compactTheme:''}`} title={chinese?'投资主题':'Investment theme'}>
    <span aria-hidden="true">✦</span>
    <select aria-label={chinese?'投资主题':'Investment theme'} value={theme} onChange={event=>onChange(event.target.value as CompanyThemeId)}>
      {themeFamilies(nodes).map(family=><optgroup key={family.id} label={family.names[chinese?'zh-CN':'en']}>{catalogThemes(nodes).filter(node=>node.parentId===family.id).map(node=><option key={node.id} value={node.id}>{themeName(node.id,chinese)}</option>)}</optgroup>)}
      {!catalogThemes(nodes).some(node=>node.id===theme)&&<option value={theme} disabled={nodes.length>0}>{theme}{nodes.length>0?(chinese?'（暂不可用）':' (unavailable)'):''}</option>}
    </select>
    {count!==undefined&&<small>{count}</small>}
  </label>;
}
