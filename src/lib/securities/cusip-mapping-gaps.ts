import { getAdminFirestore } from "@/lib/firebase/admin";

const DEFAULT_SAMPLE_LIMIT = 500;
const MAX_SAMPLE_LIMIT = 1000;

export type CusipMappingGap = {
  cusip: string;
  nameOfIssuer: string | null;
  positionCount: number;
  totalValueUsd: number;
  latestReportDate: string | null;
  latestFilingDate: string | null;
  managers: Array<{
    managerCik: string;
    managerName: string | null;
    valueUsd: number;
    reportDate: string | null;
  }>;
};

export type SecurityMappingSyncRunSummary = {
  id: string;
  exchange: string | null;
  fetched: number;
  mapped: number;
  written: number;
  skipped: number;
  pages: number;
  hasMore: boolean;
  nextOffset: number | null;
  updatedAt: string | null;
};

export type CusipMappingGapsSummary = {
  totalHoldings: number;
  unmappedHoldings: number;
  mappedHoldings: number;
  unmappedShare: number | null;
  sampledHoldings: number;
  gaps: CusipMappingGap[];
  recentMappingSyncs: SecurityMappingSyncRunSummary[];
  generatedAt: string;
};

type HoldingDocument = {
  cusip?: unknown;
  nameOfIssuer?: unknown;
  managerCik?: unknown;
  managerName?: unknown;
  valueUsd?: unknown;
  reportDate?: unknown;
  filingDate?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readIsoLike(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate() as Date;
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function normalizeSampleLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SAMPLE_LIMIT;
  }

  return Math.max(1, Math.min(MAX_SAMPLE_LIMIT, Math.trunc(value as number)));
}

function pushManager(gap: CusipMappingGap, holding: HoldingDocument) {
  const managerCik = readString(holding.managerCik);
  if (!managerCik) {
    return;
  }

  const valueUsd = readNumber(holding.valueUsd);
  const existing = gap.managers.find((manager) => manager.managerCik === managerCik);
  if (existing) {
    existing.valueUsd += valueUsd;
    const reportDate = readString(holding.reportDate);
    if (reportDate && (!existing.reportDate || reportDate > existing.reportDate)) {
      existing.reportDate = reportDate;
    }
    return;
  }

  gap.managers.push({
    managerCik,
    managerName: readString(holding.managerName),
    valueUsd,
    reportDate: readString(holding.reportDate),
  });
}

function updateGap(gap: CusipMappingGap, holding: HoldingDocument) {
  const valueUsd = readNumber(holding.valueUsd);
  const reportDate = readString(holding.reportDate);
  const filingDate = readString(holding.filingDate);

  gap.positionCount += 1;
  gap.totalValueUsd += valueUsd;
  gap.nameOfIssuer ||= readString(holding.nameOfIssuer);
  if (reportDate && (!gap.latestReportDate || reportDate > gap.latestReportDate)) {
    gap.latestReportDate = reportDate;
  }
  if (filingDate && (!gap.latestFilingDate || filingDate > gap.latestFilingDate)) {
    gap.latestFilingDate = filingDate;
  }

  pushManager(gap, holding);
  gap.managers.sort((a, b) => b.valueUsd - a.valueUsd);
  gap.managers = gap.managers.slice(0, 5);
}

function normalizeSyncRun(id: string, data: Record<string, unknown>): SecurityMappingSyncRunSummary {
  return {
    id,
    exchange: readString(data.exchange),
    fetched: readNumber(data.fetched),
    mapped: readNumber(data.mapped),
    written: readNumber(data.written),
    skipped: readNumber(data.skipped),
    pages: readNumber(data.pages),
    hasMore: readBoolean(data.hasMore),
    nextOffset: data.nextOffset === null || data.nextOffset === undefined ? null : readNumber(data.nextOffset),
    updatedAt: readIsoLike(data.updatedAt),
  };
}

export async function getCusipMappingGapsSummary(input: { sampleLimit?: number } = {}): Promise<CusipMappingGapsSummary> {
  const db = getAdminFirestore();
  const sampleLimit = normalizeSampleLimit(input.sampleLimit);
  const [totalSnapshot, unmappedSnapshot, sampleSnapshot, syncRunsSnapshot] = await Promise.all([
    db.collection("institutional_holdings").count().get(),
    db.collection("institutional_holdings").where("ticker", "==", null).count().get(),
    db.collection("institutional_holdings").where("ticker", "==", null).limit(sampleLimit).get(),
    db.collection("security_id_mapping_sync_runs").orderBy("updatedAt", "desc").limit(10).get(),
  ]);
  const totalHoldings = totalSnapshot.data().count;
  const unmappedHoldings = unmappedSnapshot.data().count;
  const gapsByCusip = new Map<string, CusipMappingGap>();

  for (const doc of sampleSnapshot.docs) {
    const data = doc.data() as HoldingDocument;
    const cusip = readString(data.cusip);
    if (!cusip) {
      continue;
    }

    const existing = gapsByCusip.get(cusip) ?? {
      cusip,
      nameOfIssuer: null,
      positionCount: 0,
      totalValueUsd: 0,
      latestReportDate: null,
      latestFilingDate: null,
      managers: [],
    };
    updateGap(existing, data);
    gapsByCusip.set(cusip, existing);
  }

  const gaps = [...gapsByCusip.values()]
    .sort((a, b) => b.totalValueUsd - a.totalValueUsd)
    .slice(0, 50);

  return {
    totalHoldings,
    unmappedHoldings,
    mappedHoldings: Math.max(0, totalHoldings - unmappedHoldings),
    unmappedShare: totalHoldings > 0 ? unmappedHoldings / totalHoldings : null,
    sampledHoldings: sampleSnapshot.size,
    gaps,
    recentMappingSyncs: syncRunsSnapshot.docs.map((doc) => normalizeSyncRun(doc.id, doc.data())),
    generatedAt: new Date().toISOString(),
  };
}
