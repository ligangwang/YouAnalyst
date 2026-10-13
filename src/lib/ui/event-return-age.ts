/** Publication age is independent of the pre-publication price baseline. */
export function eventReturnDays(publicationDate: string | undefined, latestDate: string, publishedAt?: string | null, now = Date.now(), companyId?: string): number | null {
  if (!Number.isFinite(now) || now <= 0) return null;
  if (publishedAt) {
    const published = Date.parse(publishedAt);
    if (!Number.isFinite(published) || !Number.isFinite(now) || now <= 0 || now < published) return null;
    return Math.floor((now - published) / 86_400_000);
  }
  const valid = (date: string | undefined): date is string => Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date);
  if (!valid(publicationDate) || !valid(latestDate) || latestDate < publicationDate) return null;
  // Date-only disclosures use calendar days; no publication hour is invented.
  const timeZone = companyId?.startsWith('US:') ? 'America/New_York' : /^(XSHG|XSHE):/.test(companyId??'') ? 'Asia/Shanghai' : 'UTC';
  const today = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  if (today < publicationDate) return null;
  return Math.round((Date.parse(today) - Date.parse(publicationDate)) / 86_400_000);
}
