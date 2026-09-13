export type CompanyListing = { market: string; exchange: string; symbol: string };
export type CompanyIdentity = {
  id: string;
  name: string;
  legalName?: string;
  aliases?: string[];
  website?: string;
  country?: string;
  listingStatus?: "PUBLIC" | "PRIVATE" | "UNKNOWN";
  listings?: CompanyListing[];
  identifiers?: { scheme: string; value: string }[];
};
const normalized = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const identifierValue = (scheme: string, value: string) => normalized(scheme) === "cik" && /^\d+$/.test(value.trim()) ? value.trim().replace(/^0+(?=\d)/, "") : normalized(value);
const domain = (s?: string) => {
  try { const url = new URL(s ?? ""); return url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\./, "") : ""; } catch { return ""; }
};
function keys(c: CompanyIdentity) {
  return new Set([
    ...(c.identifiers ?? []).map(i => `${normalized(i.scheme)}:${identifierValue(i.scheme, i.value)}`),
    ...(c.listings ?? []).map(l => `listing:${normalized(l.exchange)}:${normalized(l.symbol)}`),
  ]);
}
export type IdentityMatch = { status: "EXISTING" | "NEW" | "REVIEW"; ids: string[]; reason: string };
// Name and domain matches are review candidates, never proof of legal identity.
export function matchCompany(proposal: CompanyIdentity, existing: CompanyIdentity[]): IdentityMatch {
  const strong = keys(proposal);
  const matches = existing.filter(c => c.id === proposal.id || [...keys(c)].some(k => strong.has(k)));
  if (matches.length > 1) return { status: "REVIEW", ids: matches.map(c => c.id), reason: "Identifiers point to multiple company records" };
  if (matches.length === 1) {
    const c = matches[0];
    const conflict = (proposal.identifiers ?? []).some(p => (c.identifiers ?? []).some(i => normalized(i.scheme) === normalized(p.scheme) && identifierValue(i.scheme, i.value) !== identifierValue(p.scheme, p.value)));
    if (conflict || (c.country && proposal.country && c.country !== proposal.country)) return { status: "REVIEW", ids: [c.id], reason: "Identity fields conflict; verify issuer or domicile change" };
    return { status: "EXISTING", ids: [c.id], reason: "Existing ID or official identifier" };
  }
  const names = new Set([proposal.name, proposal.legalName, ...(proposal.aliases ?? [])].filter((s): s is string => !!s).map(normalized));
  const host = domain(proposal.website);
  const possible = existing.filter(c => [c.name, c.legalName, ...(c.aliases ?? [])].some(n => n && names.has(normalized(n))) || (host && domain(c.website) === host));
  return possible.length ? { status: "REVIEW", ids: possible.map(c => c.id), reason: "Name or domain overlap requires review" } : { status: "NEW", ids: [], reason: "No matching identity in the checked directory" };
}

export function companyGeography(data: Record<string, unknown>) {
  const country = typeof data.country === "string" && /^[A-Z]{2}$/.test(data.country) ? data.country : undefined;
  const listingStatus = ["PUBLIC", "PRIVATE"].includes(String(data.listingStatus)) ? data.listingStatus as "PUBLIC" | "PRIVATE" : "UNKNOWN" as const;
  const listings = Array.isArray(data.listings) ? data.listings.filter((l): l is CompanyListing => !!l && typeof l === "object" && [l.market, l.exchange, l.symbol].every(v => typeof v === "string" && v.trim().length > 0)).map(l => ({ market: l.market, exchange: l.exchange, symbol: l.symbol })) : [];
  return { ...(country ? { country } : {}), listingStatus, listings };
}

export function companyGeographyLabel(data: { country?: string; listingStatus?: string; listings?: CompanyListing[] }, locale: string) {
  const zh = locale === "zh-CN";
  let country = zh ? "国家/地区待核实" : "Country/region unverified";
  if (data.country && /^[A-Z]{2}$/.test(data.country)) country = new Intl.DisplayNames([locale], { type: "region" }).of(data.country) ?? country;
  const status = data.listingStatus === "PUBLIC" ? (zh ? "上市公司" : "Public") : data.listingStatus === "PRIVATE" ? (zh ? "非上市公司" : "Private") : (zh ? "上市状态待核实" : "Listing status unverified");
  const listings = (data.listings ?? []).map(l => `${l.exchange}: ${l.symbol}`).join(" / ");
  return [country, status, listings].filter(Boolean).join(" · ");
}
