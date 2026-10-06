import type { StoredEvent } from '../events/model';

export const CALENDAR_MODEL = 'gpt-6-luna';
export const CALENDAR_EXTRACTOR_VERSION = 'earnings-calendar-v1';
export type CalendarKind = 'earnings_release' | 'earnings_call';
export type CalendarStatus = 'scheduled' | 'rescheduled' | 'cancelled';
export type ScheduleDraft = {
  kind: CalendarKind; period: string | null; date: string | null;
  time: string | null; timezoneText: string | null;
  timeSlot: 'before_market' | 'after_market' | 'unspecified';
  status: CalendarStatus; dateEvidence: string; timeEvidence: string; periodEvidence: string;
};
export type CalendarSource = StoredEvent & { companyId?: string };
export type ScheduledEvent = StoredEvent & {
  type: 'scheduled_event'; companyId: string; eventKind: CalendarKind; fiscalPeriod: string;
  scheduled_date: string; scheduled_at: string | null; local_time: string | null;
  source_timezone: string | null; timezone_text: string | null;
  time_precision: 'exact' | 'local' | 'date'; timeSlot: ScheduleDraft['timeSlot'];
  status: CalendarStatus; confirmation: 'official'; sourceEventIds: string[];
  dateEvidence: string; timeEvidence: string; periodEvidence: string;
  announcement_date: string; extractionModel: string; contentHash: string;
};
export type CalendarItem = ScheduledEvent & {
  companyName: string; companyNames?: Record<string,string>; ticker: string;
  themes: string[]; sector: { en: string; zh: string; color: string };
};
export type CalendarPayload = {
  events: CalendarItem[]; total: number; truncated: boolean;
  from: string; to: string; lastCollectedAt: string | null; collectionStatus: string;
};
