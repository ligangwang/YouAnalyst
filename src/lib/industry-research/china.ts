import { record, sourceUrl, text, MAX_COMPANIES } from "./model";

export const MARKET_COMPANIES = "market_companies";
export type ChinaCompany = {
  id: string; name: string; en: string; stage: string; stageEn: string;
  description: string; descriptionEn: string; source: string; sourceLabel: string; sourceLabelEn: string;
};
export function validChinaId(id: string) {
  return /^(XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id);
}
export function normalizeChinaCompany(value: unknown): ChinaCompany | null {
  const raw = record(value);
  const id = text(raw.id);
  if (!validChinaId(id)) return null;
  const company: ChinaCompany = { id, name: text(raw.name).slice(0, 160), en: text(raw.en).slice(0, 160),
    stage: text(raw.stage).slice(0, 80), stageEn: text(raw.stageEn).slice(0, 80),
    description: text(raw.description).slice(0, 1200), descriptionEn: text(raw.descriptionEn).slice(0, 1200),
    source: sourceUrl(raw.source), sourceLabel: text(raw.sourceLabel).slice(0, 200), sourceLabelEn: text(raw.sourceLabelEn).slice(0, 200) };
  return Object.values(company).every(Boolean) ? company : null;
}
export function normalizeChinaResearch(value: unknown, sources: string[]) {
  const raw = record(value), allowed = new Set(sources.map(sourceUrl).filter(Boolean));
  const items = Array.isArray(raw.companies) ? raw.companies : [];
  const companies = new Map<string, ChinaCompany>();
  for (const item of items.slice(0, MAX_COMPANIES)) {
    const company = normalizeChinaCompany(item);
    if (company && allowed.has(company.source)) companies.set(company.id, company);
  }
  return { companies: [], relationships: [], chinaCompanies: [...companies.values()], withheld: items.length - companies.size };
}
