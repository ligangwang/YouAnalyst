'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from './providers/locale-provider';
import { LocalizedLink } from './localized-link';
import { useCompanyFollows } from './company-follow-button';
import { COMPANY_THEMES, themeName } from '@/lib/company-themes/model';
import { easternDay, eventDay, shiftDay, visibleDays } from '@/lib/calendar/display';
import { groupCalendarItems } from './earnings-calendar-groups';
import type { CalendarPayload } from '@/lib/calendar/model';
import { EarningsEventCard, earningsGroupLabel } from './earnings-event-card';
import styles from './earnings-calendar.module.css';

export function EarningsCalendar({initialDate='',initialCompany='',initialEvent='',initialToday,initialPayload}:{initialDate?:string;initialCompany?:string;initialEvent?:string;initialToday?:string;initialPayload?:CalendarPayload}={}) {
  const {chinese,text:t}=useLocale(),saved=useCompanyFollows();
  const agendaRef=useRef<HTMLElement>(null);
  const [today]=useState(()=>initialToday??easternDay(new Date().toISOString()));
  const [anchor,setAnchor]=useState(initialDate||today),[selected,setSelected]=useState(initialDate||today),[view,setView]=useState<'month'|'week'>('month');
  const [theme,setTheme]=useState('all'),[search,setSearch]=useState(initialCompany.split(':').at(-1)??''),[following,setFollowing]=useState(false);
  const [companyFilter,setCompanyFilter]=useState(initialCompany);
  const [payload,setPayload]=useState<CalendarPayload|null>(initialPayload??null),[requestState,setRequestState]=useState({key:initialPayload?`${initialPayload.from}|${initialPayload.to}|0`:'',error:''}),[retry,setRetry]=useState(0);
  const days=useMemo(()=>visibleDays(anchor,view),[anchor,view]),from=days[0],to=days.at(-1)!;
  const requestKey=`${from}|${to}|${retry}`,loading=requestState.key!==requestKey,error=loading?'':requestState.error;
  useEffect(()=>{
    if(requestState.key===requestKey)return;
    const controller=new AbortController();let current=true;
    const timeout=setTimeout(()=>controller.abort(),20_000);
    void fetch(`/api/calendar?from=${from}&to=${to}`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('Unavailable');
      const next=await response.json() as CalendarPayload;
      if(!Array.isArray(next.events) || next.from!==from || next.to!==to)throw new Error('Invalid calendar');
      if(current){setPayload(next);setRequestState({key:requestKey,error:''});}
    }).catch(()=>{if(current)setRequestState({key:requestKey,error:'unavailable'});}).finally(()=>clearTimeout(timeout));
    return ()=>{current=false;clearTimeout(timeout);controller.abort();};
  },[from,to,requestKey,requestState.key]);
  const items=useMemo(()=>{
    const query=search.trim().toLowerCase();
    return (payload?.events??[]).filter(item=>(!companyFilter||item.companyId===companyFilter) && (theme==='all'||item.themes.includes(theme)) && (!following || saved.ready && saved.ids.includes(item.companyId))
      && (!query || item.ticker.toLowerCase().includes(query)||item.companyName.toLowerCase().includes(query)||Object.values(item.companyNames??{}).some(name=>name.toLowerCase().includes(query))))
      .sort((a,b)=>eventDay(a).localeCompare(eventDay(b))||(a.scheduled_at??'9999').localeCompare(b.scheduled_at??'9999')||a.ticker.localeCompare(b.ticker));
  },[payload,theme,search,companyFilter,following,saved.ready,saved.ids]);
  const grouped=useMemo(()=>groupCalendarItems(items),[items]);
  // Keep the previous date range visible during a fetch, rather than mixing old data into new dates.
  const displayDays=loading&&payload?Array.from({length:Math.round((Date.parse(payload.to)-Date.parse(payload.from))/86400000)+1},(_,index)=>shiftDay(payload.from,index)):days;
  const heading=new Intl.DateTimeFormat(chinese?'zh-CN':'en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${anchor}T12:00:00Z`));
  const dayLabel=(day:string)=>new Intl.DateTimeFormat(chinese?'zh-CN':'en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));
  function move(delta:number){const next=view==='week'?shiftDay(anchor,7*delta):new Date(Date.UTC(Number(anchor.slice(0,4)),Number(anchor.slice(5,7))-1+delta,1)).toISOString().slice(0,10);setAnchor(next);setSelected(next);}
  function chooseDay(day:string){setSelected(day);if(window.matchMedia('(max-width:800px)').matches)agendaRef.current?.scrollIntoView({behavior:'smooth',block:'start'});}
  const selectedItems=grouped.get(selected)??[];
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{t('UPCOMING COMPANY EVENTS','公司活动预告')}</p><h1>{t('Earnings calendar','财报日历')}</h1><p className={styles.subtitle}>{t('Company-announced releases and calls across AI, Robotics and Space.','涵盖 AI、机器人及航天主题的公司财报发布与电话会。')}</p></div><span className={styles.zone}>{t('Times in Eastern Time · ET','时间显示为美国东部时间 · ET')}</span></header>
    <div className={styles.toolbar}><div className={styles.period}><button aria-label={t('Previous period','上一时段')} onClick={()=>move(-1)}>‹</button><h2>{heading}</h2><button aria-label={t('Next period','下一时段')} onClick={()=>move(1)}>›</button><button onClick={()=>{setAnchor(today);setSelected(today);}}>{t('Today','今天')}</button></div><div className={styles.switcher}>{(['month','week'] as const).map(value=><button key={value} aria-pressed={view===value} onClick={()=>{setAnchor(selected);setView(value);}}>{value==='month'?t('Month','月视图'):t('Week','周视图')}</button>)}</div></div>
    <div className={styles.filters}><label>{t('Theme','主题')}<select value={theme} onChange={event=>setTheme(event.target.value)}><option value="all">{t('All themes','全部主题')}</option>{COMPANY_THEMES.map(id=><option key={id} value={id}>{themeName(id,chinese)}</option>)}</select></label><label className={styles.search}><span className={styles.srOnly}>{t('Search company or ticker','搜索公司或代码')}</span><input type="search" placeholder={t('Search company / ticker','搜索公司 / 代码')} value={search} onChange={event=>{setSearch(event.target.value);setCompanyFilter('');}}/></label><label className={styles.following}><input type="checkbox" checked={following} disabled={!saved.user || !saved.ready} onChange={event=>setFollowing(event.target.checked)}/>{t('Following only','仅关注公司')}</label>{!saved.user&&<LocalizedLink href="/auth">{t('Sign in','登录')}</LocalizedLink>}{saved.error&&<button onClick={()=>void saved.refresh()}>{t('Retry following','重试加载关注')}</button>}</div>
    {payload&&payload.collectionStatus!=='complete'&&<p className="my-3 rounded-lg border border-amber-300/25 bg-amber-900/10 p-3 text-sm text-amber-100">{payload.collectionStatus==='not_started'?t('Schedule collection is starting; announced dates will appear as sources are processed.','日程采集即将开始；已公告日期将在来源处理后显示。'):t('Collection is in progress; this calendar includes announced dates and does not yet cover every company.','日程采集仍在进行中；此日历收录已公告的日期，尚未覆盖所有公司。')}</p>}
    <div className={styles.status} role="status">{loading?t('Loading schedules…','正在加载日程…'):error?t('Schedules could not be refreshed.','无法刷新日程。'):`${[...grouped.values()].flat().filter(group=>group.day>=from&&group.day<=to&&group.schedules.some(item=>item.status!=='cancelled')).length} ${t('scheduled events in view','项活动')}`}{error&&<button onClick={()=>setRetry(value=>value+1)}>{t('Retry','重试')}</button>}</div>
    <div className={`${styles.layout} ${view==='week'?styles.weekLayout:''}`} aria-busy={loading}>
      <section className={styles.calendar} aria-label={t('Earnings calendar','财报日历')}>
        <div className={`${styles.grid} ${view==='week'?styles.week:''}`}>{displayDays.map(day=>{
          const dayItems=grouped.get(day)??[],otherMonth=day.slice(0,7)!==anchor.slice(0,7);
          return <div key={day} className={`${styles.cell} ${day===selected?styles.selected:''} ${otherMonth&&view==='month'?styles.muted:''}`}><button className={styles.dayButton} onClick={()=>chooseDay(day)} aria-label={dayLabel(day)} aria-pressed={day===selected}><span>{new Intl.DateTimeFormat(chinese?'zh-CN':'en-US',{weekday:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`))}</span><strong className={day===today?styles.today:''}>{Number(day.slice(-2))}</strong>{dayItems.length>0&&<small>{dayItems.length}</small>}</button><div className={styles.cellEvents}>{dayItems.slice(0,view==='week'?4:2).map(group=><button key={group.id} className={styles.eventButton} onClick={()=>chooseDay(day)} aria-label={`${group.schedules[0].ticker} ${earningsGroupLabel(group,t)}, ${dayLabel(day)}`}><EarningsEventCard group={group} compact/></button>)}{dayItems.length>(view==='week'?4:2)&&<button className={styles.more} onClick={()=>chooseDay(day)}>+{dayItems.length-(view==='week'?4:2)} {t('more','项')}</button>}</div></div>;
        })}</div>
      </section>
      <aside ref={agendaRef} className={styles.agenda} aria-label={t('Selected day agenda','所选日期日程')}><div className={styles.agendaHeader}><p>{t('DAY AGENDA','当日日程')}</p><h2>{dayLabel(selected)}</h2><span>{selectedItems.length} {t('events','项活动')}</span></div><div className={styles.agendaEvents}>{selectedItems.map(group=><EarningsEventCard key={group.id} group={group} highlighted={group.schedules.some(item=>item.id===initialEvent)}/>)}{!selectedItems.length&&<div className={styles.empty}><span>◇</span><h3>{loading&&!payload?t('Loading schedules…','正在加载日程…'):error&&!payload?t('Schedules unavailable','日程暂不可用'):t('No announced events','暂无已公告活动')}</h3><p>{error&&!payload?t('Please retry to load the calendar.','请重试加载日历。'):t('Choose another day or widen your filters. Schedules extracted from original announcements appear here; validation warnings are marked.','请选择其他日期或调整筛选。显示从原公告提取的日程，并标注校验提示。')}</p></div>}</div></aside>
    </div>
    <footer className={styles.note}>{t('Exact times are converted to ET. Dates or local times without a confirmed time zone stay as announced.','已确认时区的时间转换为 ET；仅有日期或未确认时区的当地时间保留原公告信息。')}<br/>{payload?.collectionStatus==='not_started'?t('Schedule collection is starting. Coverage will grow as announcements are processed.','日程采集即将开始，覆盖将随公告处理逐步增加。'):payload?.collectionStatus!=='complete'?t('Collection is in progress; this is not a complete earnings calendar.','采集仍在进行中，此日历尚未完整覆盖所有公司。'):t('Based on available company announcements; absence of an event does not mean no earnings are planned.','日程基于已获取的公司公告，没有日程不代表公司没有财报计划。')}{payload?.truncated&&<p>{t('This range has more than 1,000 events. Choose a shorter period to view all schedules.','此时段超过 1,000 项活动，请缩短时段以查看全部日程。')}</p>}</footer>
  </main>;
}
