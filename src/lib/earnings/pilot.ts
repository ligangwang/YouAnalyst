export const earningsPilot = [
  { companyId: "US:NVDA", issuerId: "sec:0001045810", cik: "0001045810", name: "NVIDIA", aliases: ["NVIDIA"], irHosts: ["nvidianews.nvidia.com", "investor.nvidia.com", "s201.q4cdn.com"] },
  { companyId: "US:AMD", issuerId: "sec:0000002488", cik: "0000002488", name: "AMD", aliases: ["AMD", "Advanced Micro Devices"], irHosts: ["ir.amd.com"] },
  { companyId: "US:MSFT", issuerId: "sec:0000789019", cik: "0000789019", name: "Microsoft", aliases: ["Microsoft"], irHosts: ["www.microsoft.com"] },
  { companyId: "US:BABA", issuerId: "sec:0001577552", cik: "0001577552", name: "Alibaba", aliases: ["Alibaba"], irHosts: ["www.alibabagroup.com", "data.alibabagroup.com"] },
  { companyId: "XSHG:688981", issuerId: "cn:688981", cik: null, name: "SMIC", aliases: ["中芯国际", "中芯國際", "Semiconductor Manufacturing International"], irHosts: ["www.smics.com"] },
  { companyId: "XSHE:301308", issuerId: "cn:301308", cik: null, name: "Longsys", aliases: ["江波龙", "Longsys"], irHosts: ["www.longsys.com", "cn.longsys.com", "301308.ir-online.com.cn"] },
  { companyId: "XSHG:688256", issuerId: "cn:688256", cik: null, name: "Cambricon", aliases: ["寒武纪", "Cambricon"], irHosts: ["www.cambricon.com"] },
  { companyId: "XSHE:300308", issuerId: "cn:300308", cik: null, name: "Zhongji Innolight", aliases: ["中际旭创", "Zhongji", "Innolight"], irHosts: ["www.zj-innolight.com", "www.zj-innolight.cn"] },
] as const;
export function pilotCompany(companyId: string) {
  const company = earningsPilot.find(company => company.companyId === companyId);
  if (!company) throw new Error("Company is outside the approved earnings pilot");
  return company;
}
export function validateSourceUrl(companyId: string, value: string, provider: "sec" | "cninfo" | "issuer_ir") {
  const company = pilotCompany(companyId);
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
