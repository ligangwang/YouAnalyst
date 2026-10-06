import { eventDay } from '@/lib/calendar/display';
import type { CalendarItem } from '@/lib/calendar/model';

export type EarningsGroup = { id: string; day: string; schedules: CalendarItem[] };

/** Release and call share a card only for the same company, fiscal period and displayed day. */
export function groupCalendarItems(items: readonly CalendarItem[]) {
  const days = new Map<string, EarningsGroup[]>();
  const groups = new Map<string, EarningsGroup>();
  for (const item of items) {
    const day = eventDay(item), id = JSON.stringify([day, item.companyId, item.fiscalPeriod]);
    let group = groups.get(id);
    if (!group) {
      group = { id, day, schedules: [] };
      groups.set(id, group);
      days.set(day, [...(days.get(day) ?? []), group]);
    }
    group.schedules.push(item);
  }
  return days;
}
