'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from './providers/locale-provider';
import { LocalizedLink } from './localized-link';
import { useSavedMapCompanies } from './use-saved-map-companies';
import { COMPANY_THEMES, themeName } from '@/lib/company-themes/model';
import { calendarTime, easternDay, eventDay, shiftDay, visibleDays } from '@/lib/calendar/display';
import type { CalendarItem, CalendarPayload } from '@/lib/calendar/model';
import styles from './earnings-calendar.module.css';

export function EarningsCalendar() {
  const {chinese,text:t}=useLocale(),saved=useSavedMapCompanies();
  const agendaRef=useRef<HTMLElement>(null);
  const [today]=useState(()=>easternDay(new Date().toISOString()));
  const [anchor,setAnchor]=useState(today),[selected,setSelected]=useState(today),[view,setView]=useState<'month'|'week'>('month');
  const [theme,setTheme]=useState('all'),[search,setSearch]=useState(''),[following,setFollowing]=useState(false);
  const [payload,setPayload]=useState<CalendarPayload|null>(null),[requestState,setRequestState]=useState({key:'',error:''}),[retry,setRetry]=useState(0);
  const days=useMemo(()=>visibleDays(anchor,view),[anchor,view]),from=days[0],to=days.at(-1)!;
  const requestKey=`${from}|${to}|${retry}`,loading=requestState.key!==requestKey,error=loading?'':requestState.error;
  useEffect(()=>{
    const controller=new AbortController();let current=true;
    const timeout=setTimeout(()=>controller.abort(),20_000);
    void fetch(`/api/calendar?from=${from}&to=${to}`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('Unavailable');
      const next=await response.json() as CalendarPayload;
      if(!Array.isArray(next.events) || next.from!==from || next.to!==to)throw new Error('Invalid calendar');
      if(current){setPayload(next);setRequestState({key:requestKey,error:''});}
    }).catch(()=>{if(current)setRequestState({key:requestKey,error:'unavailable'});}).finally(()=>clearTimeout(timeout));
    return ()=>{current=false;clearTimeout(timeout);controller.abort();};
  },[from,to,requestKey]);
  const items=useMemo(()=>{
    const query=search.trim().toLowerCase();
    return (payload?.events??[]).filter(item=>(theme==='all'||item.themes.includes(theme)) && (!following || saved.ready && saved.tickers.includes(item.ticker))
      && (!query || item.ticker.toLowerCase().includes(query)||item.companyName.toLowerCase().includes(query)||Object.values(item.companyNames??{}).some(name=>name.toLowerCase().includes(query))))
      .sort((a,b)=>eventDay(a).localeCompare(eventDay(b))||(a.scheduled_at??'~').localeCompare(b.scheduled_at??'~')||a.ticker.localeCompare(b.ticker));
  },[payload,theme,search,following,saved.ready,saved.tickers]);
  const grouped=useMemo(()=>{
    const result=new Map<string,CalendarItem[]>();for(const item of items){const day=eventDay(item);result.set(day,[...(result.get(day)??[]),item]);}return result;
  },[items]);
  // Keep the previous date range visible during a fetch, rather than mixing old data into new dates.
  const displayDays=loading&&payload?Array.from({length:Math.round((Date.parse(payload.to)-Date.parse(payload.from))/86400000)+1},(_,index)=>shiftDay(payload.from,index)):days;
  const heading=new Intl.DateTimeFormat(chinese?'zh-CN':'en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${anchor}T12:00:00Z`));
  const dayLabel=(day:string)=>new Intl.DateTimeFormat(chinese?'zh-CN':'en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));
  const kindLabel=(item:CalendarItem)=>item.eventKind==='earnings_call'?t('Earnings call','业绩电话会'):t('Results release','财报发布');
  function move(delta:number){const next=view==='week'?shiftDay(anchor,7*delta):new Date(Date.UTC(Number(anchor.slice(0,4)),Number(anchor.slice(5,7))-1+delta,1)).toISOString().slice(0,10);setAnchor(next);setSelected(next);}
  function chooseDay(day:string){setSelected(day);if(window.matchMedia('(max-width:800px)').matches)agendaRef.current?.scrollIntoView({behavior:'smooth',block:'start'});}
  function card(item:CalendarItem,compact=false){return <article key={item.id} className={`${styles.event} ${item.status==='cancelled'?styles.cancelled:''}`} style={{borderLeftColor:item.sector.color}}>
    <div className={styles.eventHeading}><strong>{item.ticker}</strong><span>{kindLabel(item)}</span></div>
    {!compact&&<p>{chinese?(item.companyNames?.['zh-CN']??item.companyName):item.companyName}</p>}
    <p className={styles.time}>{calendarTime(item,chinese)}</p>
    {!compact&&<><p className={styles.detail}>{item.fiscalPeriod} · {chinese?item.sector.zh:item.sector.en}</p><div className={styles.links}><span className={styles.confirmed}>{item.status==='cancelled'?t('Cancelled','已取消'):item.status==='rescheduled'?t('Rescheduled','已改期'):t('Company announced','公司已公告')}</span><a href={item.url} target="_blank" rel="noopener noreferrer">{t('Source ↗','原公告 ↗')}</a><LocalizedLink href={`/company/${encodeURIComponent(item.companyId)}`}>{t('Company →','公司 →')}</LocalizedLink></div></>}
    {compact&&item.status!=='scheduled'&&<small>{item.status==='cancelled'?t('Cancelled','已取消'):t('Rescheduled','已改期')}</small>}
  </article>;}
  const selectedItems=grouped.get(selected)??[];
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{t('UPCOMING COMPANY EVENTS','公司活动预告')}</p><h1>{t('Earnings calendar','财报日历')}</h1><p className={styles.subtitle}>{t('Company-announced releases and calls across AI, Robotics and Space.','涵盖 AI、机器人及航天主题的公司财报发布与电话会。')}</p></div><span className={styles.zone}>{t('Times in Eastern Time · ET','时间显示为美国东部时间 · ET')}</span></header>
    <div className={styles.toolbar}><div className={styles.period}><button aria-label={t('Previous period','上一时段')} onClick={()=>move(-1)}>‹</button><h2>{heading}</h2><button aria-label={t('Next period','下一时段')} onClick={()=>move(1)}>›</button><button onClick={()=>{setAnchor(today);setSelected(today);}}>{t('Today','今天')}</button></div><div className={styles.switcher}>{(['month','week'] as const).map(value=><button key={value} aria-pressed={view===value} onClick={()=>setView(value)}>{value==='month'?t('Month','月视图'):t('Week','周视图')}</button>)}</div></div>
    <div className={styles.filters}><label>{t('Theme','主题')}<select value={theme} onChange={event=>setTheme(event.target.value)}><option value="all">{t('All themes','全部主题')}</option>{COMPANY_THEMES.map(id=><option key={id} value={id}>{themeName(id,chinese)}</option>)}</select></label><label className={styles.search}><span className={styles.srOnly}>{t('Search company or ticker','搜索公司或代码')}</span><input type="search" placeholder={t('Search company / ticker','搜索公司 / 代码')} value={search} onChange={event=>setSearch(event.target.value)}/></label><label className={styles.following}><input type="checkbox" checked={following} disabled={!saved.signedIn || !saved.ready} onChange={event=>setFollowing(event.target.checked)}/>{t('Following only','仅关注公司')}</label>{!saved.signedIn&&<LocalizedLink href="/auth">{t('Sign in','登录')}</LocalizedLink>}{saved.failed&&<button onClick={saved.retry}>{t('Retry following','重试加载关注')}</button>}</div>
    <div className={styles.status} role="status">{loading?t('Loading schedules…','正在加载日程…'):error?t('Schedules could not be refreshed.','无法刷新日程。'):`${items.filter(item=>eventDay(item)>=from&&eventDay(item)<=to&&item.status!=='cancelled').length} ${t('scheduled events in view','项活动')}`}{error&&<button onClick={()=>setRetry(value=>value+1)}>{t('Retry','重试')}</button>}</div>
    <div className={`${styles.layout} ${view==='week'?styles.weekLayout:''}`} aria-busy={loading}>
      <section className={styles.calendar} aria-label={t('Earnings calendar','财报日历')}>
        <div className={`${styles.grid} ${view==='week'?styles.week:''}`}>{displayDays.map(day=>{
          const dayItems=grouped.get(day)??[],otherMonth=day.slice(0,7)!==anchor.slice(0,7);
          return <div key={day} className={`${styles.cell} ${day===selected?styles.selected:''} ${otherMonth&&view==='month'?styles.muted:''}`}><button className={styles.dayButton} onClick={()=>chooseDay(day)} aria-label={dayLabel(day)} aria-pressed={day===selected}><span>{new Intl.DateTimeFormat(chinese?'zh-CN':'en-US',{weekday:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`))}</span><strong className={day===today?styles.today:''}>{Number(day.slice(-2))}</strong>{dayItems.length>0&&<small>{dayItems.length}</small>}</button><div className={styles.cellEvents}>{dayItems.slice(0,view==='week'?4:2).map(item=><button key={item.id} className={styles.eventButton} onClick={()=>chooseDay(day)} aria-label={`${item.ticker} ${kindLabel(item)}, ${dayLabel(day)}`}>{card(item,true)}</button>)}{dayItems.length>(view==='week'?4:2)&&<button className={styles.more} onClick={()=>chooseDay(day)}>+{dayItems.length-(view==='week'?4:2)} {t('more','项')}</button>}</div></div>;
        })}</div>
      </section>
      <aside ref={agendaRef} className={styles.agenda} aria-label={t('Selected day agenda','所选日期日程')}><div className={styles.agendaHeader}><p>{t('DAY AGENDA','当日日程')}</p><h2>{dayLabel(selected)}</h2><span>{selectedItems.length} {t('events','项活动')}</span></div><div className={styles.agendaEvents}>{selectedItems.map(item=>card(item))}{!selectedItems.length&&<div className={styles.empty}><span>◇</span><h3>{loading&&!payload?t('Loading schedules…','正在加载日程…'):error&&!payload?t('Schedules unavailable','日程暂不可用'):t('No announced events','暂无已公告活动')}</h3><p>{error&&!payload?t('Please retry to load the calendar.','请重试加载日历。'):t('Choose another day or widen your filters. Only schedules confirmed in original announcements appear here.','请选择其他日期或调整筛选。仅显示原公告已确认的日程。')}</p></div>}</div></aside>
    </div>
    <footer className={styles.note}>{t('Exact times are converted to ET. Dates or local times without a confirmed time zone stay as announced.','已确认时区的时间转换为 ET；仅有日期或未确认时区的当地时间保留原公告信息。')}<br/>{payload?.collectionStatus==='not_started'?t('Schedule collection is starting. Coverage will grow as announcements are processed.','日程采集即将开始，覆盖将随公告处理逐步增加。'):payload?.collectionStatus!=='complete'?t('Collection is in progress; this is not a complete earnings calendar.','采集仍在进行中，此日历尚未完整覆盖所有公司。'):t('Based on available company announcements; absence of an event does not mean no earnings are planned.','日程基于已获取的公司公告，没有日程不代表公司没有财报计划。')}{payload?.truncated&&<p>{t('This range has more than 1,000 events. Choose a shorter period to view all schedules.','此时段超过 1,000 项活动，请缩短时段以查看全部日程。')}</p>}</footer>
  </main>;
}
