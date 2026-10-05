/** Compact activity timestamps shared by every relative-time display. */
export function formatRelativeDateTime(value: string, now = Date.now(), locale = "en"): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const chinese = locale.startsWith("zh");
  const unit = (amount: number, compact: string, localized: string) => chinese ? `${amount}${localized}前` : `${amount}${compact}`;
  if (seconds < 60) return chinese ? "刚刚" : "now";
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "m", "分钟");
  if (seconds < 86400) return unit(Math.floor(seconds / 3600), "h", "小时");
  const date = new Date(timestamp);
  const end = new Date(now);
  let months = (end.getUTCFullYear() - date.getUTCFullYear()) * 12 + end.getUTCMonth() - date.getUTCMonth();
  const anniversary = new Date(timestamp);
  anniversary.setUTCMonth(date.getUTCMonth() + months);
  if (anniversary > end) months--;
  if (months < 1) return unit(Math.floor(seconds / 86400), "d", "天");
  if (months < 12) return unit(months, "mo", "个月");
  return unit(Math.floor(months / 12), "y", "年");
}

export function formatAbsoluteDateTime(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}
