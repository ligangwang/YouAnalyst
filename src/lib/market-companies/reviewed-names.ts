import reviewed from "../../../data/ai-supply-chain/company-names.json";

const companies = new Map(reviewed.companies.map(company => [company.id, company]));

/** Fill missing translations from reviewed identity records; preserve admin edits. */
export function reviewedCompanyNames(id: string, name: string, names: unknown) {
  const provided = names && typeof names === "object" ? names as Record<string, unknown> : {};
  const fallback = companies.get(id);
  // The exchange-qualified ID and expected source name must both match.
  const verified = fallback?.expectedName === name ? fallback.names : undefined;
  return Object.fromEntries((["en", "zh-CN"] as const).flatMap(locale => {
    const value = typeof provided[locale] === "string" && provided[locale].trim() ? provided[locale].trim() : verified?.[locale];
    return value ? [[locale, value]] : [];
  }));
}
