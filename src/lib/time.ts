/** Compact activity timestamps shared by every relative-time display. */
export function formatRelativeDateTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  const date = new Date(timestamp);
  const end = new Date(now);
  let months = (end.getUTCFullYear() - date.getUTCFullYear()) * 12 + end.getUTCMonth() - date.getUTCMonth();
  const anniversary = new Date(timestamp);
  anniversary.setUTCMonth(date.getUTCMonth() + months);
  if (anniversary > end) months--;
  if (months < 1) return `${Math.floor(seconds / 86400)}d`;
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

export function formatAbsoluteDateTime(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}
