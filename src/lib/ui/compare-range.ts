import { isoDate, validateCompareConfig, yearsBefore, type CompareConfig } from "../compare";

export const MAX_PLAYBACK_YEARS = 5;
export const EARLIEST_PLAYBACK_DATE = "2020-12-31";

export function playbackStartDate(end: string, years = MAX_PLAYBACK_YEARS): string {
  const start = isoDate(end) ? yearsBefore(end, years) : EARLIEST_PLAYBACK_DATE;
  return start < EARLIEST_PLAYBACK_DATE ? EARLIEST_PLAYBACK_DATE : start;
}

// The website and its comparison endpoint share the same playback limit.
export function validatePlaybackConfig(config: CompareConfig, now = new Date()): string | null {
  if (isoDate(config.start) && config.start < EARLIEST_PLAYBACK_DATE) return "Choose a start date on or after December 31, 2020.";
  if (isoDate(config.start) && isoDate(config.end) && config.start < yearsBefore(config.end, MAX_PLAYBACK_YEARS)) return "Choose a period of 5 years or less.";
  return validateCompareConfig(config, now);
}
