"use client";

import type { IntelligenceCalendarEvent } from '@/lib/intelligence/model';
import { LocalizedLink } from './localized-link';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-live.module.css';

export function IntelligenceCalendarLinks({events}:{events?:IntelligenceCalendarEvent[]}) {
  const {text}=useLocale();
  const grouped=new Map<string,IntelligenceCalendarEvent>();
  for(const event of events??[]){const key=`${event.companyId}|${event.day}`,previous=grouped.get(key);grouped.set(key,{...event,validationWarning:event.validationWarning||previous?.validationWarning});}
  const links=[...grouped.values()];
  if(!links.length)return null;
  return <span className={styles.calendarLinks}>{links.map(event=>{
    const label=event.validationWarning?text(`View calendar event (validation warning) · ${event.day}`,`查看日历活动（校验提示） · ${event.day}`):text(`View calendar event · ${event.day}`,`查看日历活动 · ${event.day}`);
    return <LocalizedLink key={`${event.companyId}|${event.day}`} href={`/calendar?${new URLSearchParams({date:event.day,company:event.companyId,event:event.id})}`}
      title={label} aria-label={label} className={event.validationWarning?styles.calendarWarning:undefined}>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-10 5 2 2 4-4"/></svg>
    </LocalizedLink>;
  })}</span>;
}
