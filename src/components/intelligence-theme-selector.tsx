"use client";
import { COMPANY_THEMES, themeName, type CompanyThemeId } from '@/lib/company-themes/model';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-center-views.module.css';

export function IntelligenceThemeSelector({theme,onChange,count,compact=false}:{theme:CompanyThemeId;onChange:(theme:CompanyThemeId)=>void;count?:number;compact?:boolean}) {
  const {chinese}=useLocale();
  return <label className={`${styles.themeSelector} ${compact?styles.compactTheme:''}`}>
    <span aria-hidden="true">✦</span>
    <select aria-label={chinese?'投资主题':'Investment theme'} value={theme} onChange={event=>onChange(event.target.value as CompanyThemeId)}>
      {COMPANY_THEMES.map(id=><option key={id} value={id}>{themeName(id,chinese)}</option>)}
    </select>
    {count!==undefined&&<small>{count}</small>}
  </label>;
}
