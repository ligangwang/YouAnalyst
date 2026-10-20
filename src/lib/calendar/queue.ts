import {isCalendarCandidate} from './candidates';

export function calendarCandidate(row: Record<string, unknown>) {
  return ['company_news','company_disclosure'].includes(String(row.type))
    && ['company_ir','exchange'].includes(String(row.sourceType))
    && Array.isArray(row.companyIds) && row.companyIds.length===1
    && typeof row.publication_date==='string' && row.publication_date>='2026-01-01'
    && typeof row.title==='string' && isCalendarCandidate(row.title,typeof row.summary==='string'?row.summary:'');
}
/** A single indexed due-time field covers new work and scheduled content checks. */
export function calendarQueueFields(row: Record<string, unknown>) {
  const state=row.calendarExtraction as {nextCheckAtMs?:number}|undefined;
  return {calendarNextCheckAtMs:calendarCandidate(row)
    ? (Number.isFinite(state?.nextCheckAtMs)?state!.nextCheckAtMs!:0):Number.MAX_SAFE_INTEGER};
}
