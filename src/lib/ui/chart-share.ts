import { DEFAULT_TIMELINE_RANGE, TIMELINE_RANGES, type TimelineRange } from './company-timeline';
import { MA_PERIODS } from './technical-indicators';
import { companyPageUrl } from '../market-companies/routes';
import { localizedPath } from '../i18n/urls';
import type { Locale } from '../locale';
import type { CompanyThemeId } from '../company-themes/model';

export type SharedChart = { range: TimelineRange; style: 'candles' | 'line'; averages: number[]; macd: boolean; events: boolean };

export function parseSharedChart(params: URLSearchParams): SharedChart {
  const raw = params.get('chartRange');
  const range = raw === 'ytd' ? 'ytd' : Number(raw);
  const rawAverages = params.get('chartMA');
  const requested = new Set((rawAverages ? rawAverages.split(',').map(Number) : MA_PERIODS));
  return {
    range: TIMELINE_RANGES.includes(range as TimelineRange) ? range as TimelineRange : DEFAULT_TIMELINE_RANGE,
    style: params.get('chartStyle') === 'line' ? 'line' : 'candles',
    averages: MA_PERIODS.filter(period => requested.has(period)),
    macd: params.get('chartMacd') === '1',
    events: params.get('chartEvents') !== '0',
  };
}

export function sharedChartParams(chart: SharedChart): Record<string, string> {
  return { chartRange: String(chart.range), chartStyle: chart.style, chartMA: chart.averages.join(',') || 'none', chartMacd: chart.macd ? '1' : '0', chartEvents: chart.events ? '1' : '0' };
}

/** Build from an allowlist; account state and browsing filters never enter a share. */
export function chartShareUrl(companyId: string, locale: Locale, chart: SharedChart, eventId = '', exploreEvent = false, theme: CompanyThemeId = 'ai'): string {
  const market = companyId.startsWith('ORG:') ? 'GLOBAL' : companyId.startsWith('US:') ? 'US' : 'CN_A';
  const profile = companyPageUrl(market === 'US' ? companyId.slice(3) : companyId, market);
  const url = new URL(localizedPath(exploreEvent && eventId ? '/' : profile, locale), 'https://youanalyst.com');
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
