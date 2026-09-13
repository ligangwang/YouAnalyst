export type ProfileLink = { url: string; sourceUrl: string };
export type CompanyProfile = {
  checkedAt: string;
  website?: ProfileLink;
  investorRelations?: ProfileLink;
  disclosures?: ProfileLink;
  location?: { label: string; kind: "BUSINESS_ADDRESS" | "OFFICE" | "HEADQUARTERS"; sourceUrl: string };
  financialReport?: { title: string; url: string; periodEnd: string; publishedAt: string; form: string };
  financialReportStatus: "AVAILABLE" | "NOT_FOUND" | "UNVERIFIED";
  financialReportCheckedSources?: string[];
};
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function profileUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try { const u = new URL(v); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function profileDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}
export function normalizeCompanyProfile(value: unknown): CompanyProfile | null {
  const raw = record(value);
  if (!profileDate(raw.checkedAt) || !["AVAILABLE", "NOT_FOUND", "UNVERIFIED"].includes(String(raw.financialReportStatus))) return null;
  const profile: CompanyProfile = { checkedAt: raw.checkedAt, financialReportStatus: raw.financialReportStatus as CompanyProfile["financialReportStatus"] };
  if (Array.isArray(raw.financialReportCheckedSources)) profile.financialReportCheckedSources = raw.financialReportCheckedSources.map(profileUrl).filter((u): u is string => Boolean(u)).slice(0, 10);
  if (profile.financialReportStatus === "NOT_FOUND" && !profile.financialReportCheckedSources?.length) return null;
  for (const field of ["website", "investorRelations", "disclosures"] as const) {
    const link = record(raw[field]), url = profileUrl(link.url), sourceUrl = profileUrl(link.sourceUrl);
    if (url && sourceUrl) profile[field] = { url, sourceUrl };
  }
  const location = record(raw.location), sourceUrl = profileUrl(location.sourceUrl);
  if (typeof location.label === "string" && location.label.trim() && location.label.length <= 500 && sourceUrl && ["BUSINESS_ADDRESS", "OFFICE", "HEADQUARTERS"].includes(String(location.kind))) {
    profile.location = { label: location.label.trim(), sourceUrl, kind: location.kind as NonNullable<CompanyProfile["location"]>["kind"] };
  }
  const report = record(raw.financialReport), url = profileUrl(report.url);
  if (url && typeof report.title === "string" && report.title.trim() && report.title.length <= 300 && typeof report.form === "string" && report.form.length <= 40 && profileDate(report.periodEnd) && profileDate(report.publishedAt) && report.periodEnd <= report.publishedAt && report.publishedAt <= profile.checkedAt) {
    profile.financialReport = { url, title: report.title.trim(), form: report.form, periodEnd: report.periodEnd, publishedAt: report.publishedAt };
  }
  if (profile.financialReportStatus === "AVAILABLE" && !profile.financialReport) return null;
  if (profile.financialReportStatus !== "AVAILABLE" && profile.financialReport) return null;
  return profile;
}
