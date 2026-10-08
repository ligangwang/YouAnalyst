"use client";

import { LocalizedLink as Link } from './localized-link';
import { UiText } from './ui-text';
import { IntelligenceThemeSelector } from './intelligence-theme-selector';
import { themeName, type CompanyThemeId } from '@/lib/company-themes/model';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-loading-shell.module.css';

/** Shared lightweight shell keeps server and client loading states visually consistent. */
export function IntelligenceLoadingShell({theme='ai',onThemeChange,error='',onRetry}:{theme?:CompanyThemeId;onThemeChange?:(theme:CompanyThemeId)=>void;error?:string;onRetry?:()=>void}={}) {
  const {chinese}=useLocale();
  return <main className={styles.shell} aria-busy={!error}>
    <h1 className={styles.srOnly}><UiText text="Investment Intelligence"/></h1>
    <div className={styles.toolbar}>
      {onThemeChange?<IntelligenceThemeSelector theme={theme} onChange={onThemeChange} compact/>:<span className={styles.theme}>✦ {themeName(theme,chinese)}</span>}
      <p className={styles.status} role={error?'alert':'status'}>{!error&&<span className={styles.indicator} aria-hidden="true"/>}<UiText text={error||'Preparing your workspace…'}/></p>
      {error&&onRetry&&<button className={styles.retry} onClick={onRetry}><UiText text="Retry connection"/></button>}
    </div>
    <div className={styles.workspace} aria-hidden="true">
      <div className={styles.sidebar}><span className={styles.shortLine}/><span className={styles.search}/>{Array.from({length:6},(_,index)=><div className={styles.row} key={index}><span className={styles.dot}/><span className={styles.line}/></div>)}</div>
      <div className={styles.map}><div className={styles.tabs}><span/><span/><span/></div><svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet"><g className={styles.edges}><path d="M110 210L235 125L350 205L475 130M235 125L290 310L350 205L470 295M110 210L290 310"/></g><g className={styles.nodes}>{[[110,210],[235,125],[350,205],[475,130],[290,310],[470,295]].map(([x,y])=><circle key={`${x}:${y}`} cx={x} cy={y} r="7"/>)}</g></svg></div>
      <div className={`${styles.sidebar} ${styles.events}`}><span className={styles.shortLine}/>{Array.from({length:3},(_,index)=><div className={styles.event} key={index}><span className={styles.shortLine}/><span className={styles.line}/><span className={styles.line}/></div>)}</div>
    </div>
    <nav aria-label="Research navigation" className={styles.navigation}><Link href="/companies" prefetch={false}><UiText text="Companies"/></Link><Link href="/research" prefetch={false}><UiText text="Research"/></Link></nav>
  </main>;
}
