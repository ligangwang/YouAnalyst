'use client';

import { calendarTime } from '@/lib/calendar/display';
import type { EarningsGroup } from './earnings-calendar-groups';
import { companyPageUrl } from '@/lib/market-companies/routes';
import { LocalizedLink } from './localized-link';
import { useLocale } from './providers/locale-provider';
import styles from './earnings-calendar.module.css';

export function earningsGroupLabel(group: EarningsGroup, text: (en: string, zh: string) => string) {
  const call = group.schedules.some(item => item.eventKind === 'earnings_call');
  const release = group.schedules.some(item => item.eventKind === 'earnings_release');
  return call && release ? text('Results & call', '财报与电话会')
    : call ? text('Earnings call', '业绩电话会') : text('Results release', '财报发布');
}

/** The calendar grid and day agenda render the same schedules at different detail levels. */
export function EarningsEventCard({ group, compact = false, highlighted = false }: { group: EarningsGroup; compact?: boolean; highlighted?:boolean }) {
  const { chinese, text: t } = useLocale();
  const schedules = [...group.schedules].sort((a, b) => (a.eventKind === 'earnings_release' ? 0 : 1) - (b.eventKind === 'earnings_release' ? 0 : 1));
  const item = schedules[0];
  const sharedStatus = schedules.every(schedule => schedule.status === item.status) ? item.status : null;
  const sources = [...new Map(schedules.map(schedule => [schedule.url, schedule])).values()];
  const warnings=[...new Set(schedules.flatMap(schedule=>schedule.validationWarnings??[]))];

  return <article className={`${styles.event} ${highlighted ? styles.linkedEvent : ''} ${sharedStatus === 'cancelled' ? styles.cancelled : ''}`} style={{ borderLeftColor: item.sector.color }}>
    <div className={styles.eventHeading}><strong>{item.ticker}</strong><span>{earningsGroupLabel(group, t)}</span></div>
    {!compact && <p>{chinese ? (item.companyNames?.['zh-CN'] ?? item.companyName) : item.companyName}</p>}
    {warnings.length>0 && <span className={styles.validationWarning} title={warnings.join('\n')}>{t('⚠ Validation warning','⚠ 校验提示')}</span>}
    {schedules.map(schedule => <p key={schedule.id} className={`${styles.time} ${!sharedStatus && schedule.status === 'cancelled' ? styles.cancelledSchedule : ''}`}>
      {schedules.length > 1 && <span className={styles.scheduleLabel}>{schedule.eventKind === 'earnings_release' ? t('Results', '财报') : t('Call', '电话会')}: </span>}{calendarTime(schedule, chinese)}
      {!sharedStatus && schedule.status !== 'scheduled' && <small className={styles.scheduleStatus}> · {schedule.status === 'cancelled' ? t('Cancelled', '已取消') : t('Rescheduled', '已改期')}</small>}
    </p>)}
    {!compact && <>
      <p className={styles.detail}>{item.fiscalPeriod} · {chinese ? item.sector.zh : item.sector.en}</p>
      {warnings.length>0 && <details className={styles.validationDetails}><summary>{t('View validation warning','查看校验提示')}</summary><p>{t('Shown from the AI extraction; automatic source checks could not verify every detail. Check the original announcement.','此日程来自 AI 提取，自动校验未能核实所有细节，请查看原公告。')}</p><ul>{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>}
      <div className={styles.links}>
        <span className={styles.confirmed}>{sharedStatus === 'cancelled' ? t('Cancelled', '已取消') : sharedStatus === 'rescheduled' ? t('Rescheduled', '已改期') : warnings.length ? t('AI extracted','AI 提取') : t('Company announced', '公司已公告')}</span>
        {sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{sources.length === 1 ? t('Source ↗', '原公告 ↗') : source.eventKind === 'earnings_release' ? t('Results source ↗', '财报公告 ↗') : t('Call source ↗', '电话会公告 ↗')}</a>)}
        <LocalizedLink href={companyPageUrl(item.companyId.startsWith('US:') ? item.ticker : item.companyId, /^(XSHG|XSHE):/.test(item.companyId) ? 'CN_A' : undefined)}>{t('Company →', '公司 →')}</LocalizedLink>
      </div>
    </>}
    {compact && sharedStatus && sharedStatus !== 'scheduled' && <small>{sharedStatus === 'cancelled' ? t('Cancelled', '已取消') : t('Rescheduled', '已改期')}</small>}
  </article>;
}
