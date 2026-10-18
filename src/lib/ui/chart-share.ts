import { DEFAULT_TIMELINE_RANGE, TIMELINE_RANGES, TIMELINE_INTERVALS, type TimelineRange, type TimelineIntervalChoice } from './company-timeline';
import { MA_PERIODS, movingAveragePeriods } from './technical-indicators';
import { companyPageUrl } from '../market-companies/routes';
import { localizedPath } from './i18n/urls';
import type { Locale } from '../locale';
import type { CompanyThemeId } from '../company-themes/model';

export type ChartIndicator = 'none'|'macd'|'kdj'|'boll';
export type SharedChart = { range: TimelineRange; interval:TimelineIntervalChoice; style: 'candles' | 'line'; averages: number[]; macd: boolean; indicator:ChartIndicator; activity:'volume'|'turnover'; events: boolean };

export function parseSharedChart(params: URLSearchParams): SharedChart {
  const raw = params.get('chartRange');
  const range = raw === 'ytd' ? 'ytd' : Number(raw);
  const requestedInterval=params.get('chartInterval');
  const rawAverages = params.get('chartMA');
  const requested = movingAveragePeriods(rawAverages ? rawAverages.split(',').map(Number) : [...MA_PERIODS]);
  const rawIndicator=params.get('chartIndicator');
  const indicator:ChartIndicator=rawIndicator==='macd'||rawIndicator==='kdj'||rawIndicator==='boll'||rawIndicator==='none'?rawIndicator:params.get('chartMacd')==='1'?'macd':'none';
  return {
    range: TIMELINE_RANGES.includes(range as TimelineRange) ? range as TimelineRange : DEFAULT_TIMELINE_RANGE,
    interval:TIMELINE_INTERVALS.includes(requestedInterval as typeof TIMELINE_INTERVALS[number])?requestedInterval as TimelineIntervalChoice:'auto',
    style: params.get('chartStyle') === 'line' ? 'line' : 'candles',
    averages: requested,
    macd: indicator==='macd',
    indicator,
    activity:params.get('chartActivity')==='turnover'?'turnover':'volume',
    events: params.get('chartEvents') !== '0',
  };
}

export function sharedChartParams(chart: SharedChart): Record<string, string> {
  return { chartRange: String(chart.range), chartInterval:chart.interval, chartStyle: chart.style, chartMA: chart.averages.join(',') || 'none', chartMacd: chart.macd ? '1' : '0', chartIndicator:chart.indicator,chartActivity:chart.activity, chartEvents: chart.events ? '1' : '0' };
}

export function companyResearchPath(companyId:string,locale:Locale){
  const market = companyId.startsWith('ORG:') ? 'GLOBAL' : companyId.startsWith('US:') ? 'US' : 'CN_A';
  const profile = companyPageUrl(market === 'US' ? companyId.slice(3) : companyId, market);
  return localizedPath(profile,locale);
}
/** Build from an allowlist; account state and browsing filters never enter a share. */
export function chartShareUrl(companyId: string, locale: Locale, chart: SharedChart, eventId = '', exploreEvent = false, theme: CompanyThemeId = 'ai'): string {
  const url = new URL(exploreEvent && eventId?localizedPath('/',locale):companyResearchPath(companyId,locale), 'https://youanalyst.com');
  for (const [key, value] of Object.entries(sharedChartParams(chart))) if (value) url.searchParams.set(key, value);
  if (eventId) url.searchParams.set(exploreEvent ? 'event' : 'chartEvent', eventId);
  if (exploreEvent && eventId) {
    url.searchParams.set('theme', theme);
    url.searchParams.set('company', companyId);
    url.searchParams.set('view', 'graph');
  }
  url.hash = 'company-timeline';
  return url.href;
}
