import { hasInsiderValueReviewHold } from "../securities/insider-value-quality";

export type InsiderActivity = { owner: string; code: string; date: string; security: string; shares: number | null; valueUsd: number | null };
const amount = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER ? v : null;
export function activityFromTransaction(row: Record<string, unknown>, accessionNumber: string): InsiderActivity | null {
  if (row.accessionNumber !== accessionNumber || typeof row.reportingOwnerName !== "string" || !row.reportingOwnerName.trim() || typeof row.transactionCode !== "string" || !/^[A-Z]$/.test(row.transactionCode) || typeof row.transactionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.transactionDate) || !Number.isFinite(Date.parse(row.transactionDate)) || new Date(row.transactionDate).toISOString().slice(0,10) !== row.transactionDate) return null;
  return {owner:row.reportingOwnerName.trim().slice(0,200),code:row.transactionCode,date:row.transactionDate,security:typeof row.securityTitle === "string" ? row.securityTitle.slice(0,200) : "", shares:amount(row.shares),valueUsd:row.valueQuality === "usable" && !hasInsiderValueReviewHold({accessionNumber}) ? amount(row.valueUsd) : null};
}
export function publicActivity(value: unknown, accessionNumber: string): InsiderActivity[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0,5).flatMap(row => {
    if (!row || typeof row !== "object") return [];
    const activity = activityFromTransaction({accessionNumber,reportingOwnerName:row.owner,transactionCode:row.code,transactionDate:row.date,securityTitle:row.security,shares:row.shares,valueUsd:row.valueUsd,valueQuality:"usable"},accessionNumber);
    return activity ? [activity] : [];
  });
}
export function activityLabel(code: string, chinese: boolean) {
  const labels: Record<string,[string,string]> = {P:["Purchase","买入"],S:["Sale","卖出"],A:["Grant / award / other acquisition","授予／奖励／其他取得"],M:["Exercise / conversion","行权／转换"],F:["Tax / exercise withholding","税款／行权代扣"],G:["Gift","赠与"],D:["Disposition to issuer","向发行人处置"],C:["Conversion","转换"],J:["Other transaction","其他交易"]};
  return labels[code]?.[chinese ? 1 : 0] ?? (chinese ? `其他交易（代码 ${code}）` : `Other transaction (code ${code})`);
}
