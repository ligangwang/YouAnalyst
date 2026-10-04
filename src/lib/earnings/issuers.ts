import type { KnowledgeGraph } from '../knowledge-graph/model';
import { mapListedCompanies } from '../events/disclosures';

// Reviewed adapter hints and fixture identities, never the production universe.
export const reviewedEarningsIssuers = [
  { companyId: "US:NVDA", issuerId: "sec:0001045810", cik: "0001045810", name: "NVIDIA", aliases: ["NVIDIA"], irHosts: ["nvidianews.nvidia.com", "investor.nvidia.com", "s201.q4cdn.com"] },
  { companyId: "US:AMD", issuerId: "sec:0000002488", cik: "0000002488", name: "AMD", aliases: ["AMD", "Advanced Micro Devices"], irHosts: ["ir.amd.com"] },
  { companyId: "US:MSFT", issuerId: "sec:0000789019", cik: "0000789019", name: "Microsoft", aliases: ["Microsoft"], irHosts: ["www.microsoft.com"] },
  { companyId: "US:BABA", issuerId: "sec:0001577552", cik: "0001577552", name: "Alibaba", aliases: ["Alibaba"], irHosts: ["www.alibabagroup.com", "data.alibabagroup.com"] },
  { companyId: "XSHG:688981", issuerId: "cn:688981", cik: null, name: "SMIC", aliases: ["中芯国际", "中芯國際", "Semiconductor Manufacturing International"], irHosts: ["www.smics.com"] },
  { companyId: "XSHE:301308", issuerId: "cn:301308", cik: null, name: "Longsys", aliases: ["江波龙", "Longsys"], irHosts: ["www.longsys.com", "cn.longsys.com", "301308.ir-online.com.cn"] },
  { companyId: "XSHG:688256", issuerId: "cn:688256", cik: null, name: "Cambricon", aliases: ["寒武纪", "Cambricon"], irHosts: ["www.cambricon.com"] },
  { companyId: "XSHE:300308", issuerId: "cn:300308", cik: null, name: "Zhongji Innolight", aliases: ["中际旭创", "Zhongji", "Innolight"], irHosts: ["www.zj-innolight.com", "www.zj-innolight.cn"] },
] as const;
export type EarningsCompany = { companyId: string; issuerId: string; cik: string | null; name: string; aliases: readonly string[]; irHosts: readonly string[] };
let companies = new Map<string, EarningsCompany>(reviewedEarningsIssuers.map(company => [company.companyId, company]));
let mapped: KnowledgeGraph | undefined;
export function earningsCompanies() { return [...companies.values()]; }
export function restoreEarningsFixtures() { mapped = undefined; companies = new Map(reviewedEarningsIssuers.map(company => [company.companyId, company])); }
export function configureEarningsMap(graph: KnowledgeGraph, ciks: ReadonlyMap<string, string>) {
  mapped = graph;
  companies = new Map();
  for (const node of mapListedCompanies(graph)) {
    const cik = node.market === 'US' ? ciks.get(node.id) : null;
    if (node.market === 'US' && !cik) continue;
    registerEarningsIssuer(node.id, cik ?? null);
  }
}
export function registerEarningsIssuer(companyId: string, cik: string | null) {
  const node = mapped && mapListedCompanies(mapped).find(node => node.id === companyId);
  if (!node || (node.market === 'US' ? !cik || !/^\d{10}$/.test(cik) || Number(cik) === 0 : cik !== null)) throw new Error('Unverified map earnings issuer');
  const hint = reviewedEarningsIssuers.find(company => company.companyId === companyId);
  if (hint?.cik && hint.cik !== cik) throw new Error('Reviewed issuer CIK changed');
  const aliases = [...new Set([node.name, ...Object.values(node.names ?? {}), ...(node.aliases ?? []), ...(hint?.aliases ?? [])].filter((value): value is string => !!value?.trim()))];
  if (!aliases.length) throw new Error('Missing map issuer name');
  companies.set(companyId, { companyId, cik, issuerId: cik ? `sec:${cik}` : `cn:${companyId.split(':')[1]}`, name: node.names?.en ?? node.name ?? aliases[0], aliases, irHosts: hint?.irHosts ?? [] });
}
export function earningsCompany(companyId: string) {
  const company = companies.get(companyId);
  if (!company) throw new Error("Company has no verified map earnings identity");
  return company;
}
export function validateSourceUrl(companyId: string, value: string, provider: "sec" | "cninfo" | "issuer_ir") {
  const company = earningsCompany(companyId);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new Error("Unsafe earnings source URL");
  const allowed: readonly string[] = provider === "sec" ? ["www.sec.gov"] : provider === "cninfo" ? ["static.cninfo.com.cn", "dataclouds.cninfo.com.cn", "www.cninfo.com.cn"] : company.irHosts;
  if (!allowed.includes(url.hostname)) throw new Error("Unapproved earnings source host");
  if (provider === "sec") {
    const match = /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/([\w.-]+)$/.exec(url.pathname);
    if (!company.cik || !match || Number(match[1]) !== Number(company.cik)) throw new Error("SEC source issuer mismatch");
  }
  if (/%2e|%2f|%5c/i.test(url.pathname)) throw new Error("Unsafe encoded source path");
  return url.href;
}
