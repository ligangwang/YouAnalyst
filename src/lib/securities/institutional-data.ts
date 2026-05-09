import { FieldPath } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { normalizeTicker } from "@/lib/predictions/types";
import type { InstitutionalHolding, InstitutionalHoldingChange } from "@/lib/securities/thirteen-f";

const DEFAULT_TICKER_SCAN_LIMIT = 1200;
const DEFAULT_MANAGER_DISPLAY_LIMIT = 100;
const DEFAULT_DISCOVERY_MANAGER_LIMIT = 36;
const DEFAULT_DISCOVERY_ACTIVITY_LIMIT = 200;

type InstitutionalManagerDocument = {
  cik?: unknown;
  name?: unknown;
  latestAccessionNumber?: unknown;
  latestReportDate?: unknown;
  latestQuarter?: unknown;
  updatedAt?: unknown;
};

export type InstitutionalTickerPosition = {
  managerCik: string;
  managerName: string;
  ticker: string;
  nameOfIssuer: string;
  quarter: string;
  reportDate: string;
  filingDate: string;
  accessionNumber: string;
  shares: number;
  valueUsd: number;
  positionCount: number;
  changeStatus: InstitutionalHoldingChange["status"] | null;
  shareChange: number | null;
  valueChangeUsd: number | null;
  percentChange: number | null;
  updatedAt: string;
};

export type InstitutionalTickerActivity = {
  managerCik: string;
  managerName: string;
  status: InstitutionalHoldingChange["status"];
  valueChangeUsd: number;
  shareChange: number;
  percentChange: number | null;
  reportDate: string;
  accessionNumber: string;
};

export type InstitutionalTickerSummary = {
  ticker: string;
  totalManagers: number;
  totalValueUsd: number;
  totalShares: number;
  netValueChangeUsd: number;
  increasedManagers: number;
  reducedManagers: number;
  newManagers: number;
  soldOutManagers: number;
  latestReportDate: string | null;
  topBuyers: InstitutionalTickerActivity[];
  topSellers: InstitutionalTickerActivity[];
  positions: InstitutionalTickerPosition[];
};

export type InstitutionalManagerSummary = {
  manager: {
    cik: string;
    name: string;
    latestAccessionNumber: string | null;
    latestReportDate: string | null;
    latestQuarter: string | null;
    updatedAt: string | null;
  };
  holdings: Array<InstitutionalHolding & {
    changeStatus: InstitutionalHoldingChange["status"] | null;
    shareChange: number | null;
    valueChangeUsd: number | null;
    percentChange: number | null;
  }>;
};

export type InstitutionalDiscoveryManager = {
  cik: string;
  name: string;
  latestAccessionNumber: string | null;
  latestReportDate: string | null;
  latestQuarter: string | null;
  updatedAt: string | null;
};

export type InstitutionalDiscoveryTickerActivity = {
  ticker: string;
  nameOfIssuer: string;
  reportDate: string;
  managerCount: number;
  netValueChangeUsd: number;
  grossValueChangeUsd: number;
  newManagers: number;
  increasedManagers: number;
  reducedManagers: number;
  soldOutManagers: number;
  topManagers: Array<{
    managerCik: string;
    managerName: string;
    status: InstitutionalHoldingChange["status"];
    valueChangeUsd: number;
  }>;
};

export type InstitutionalDiscoverySummary = {
  managers: InstitutionalDiscoveryManager[];
  activeTickers: InstitutionalDiscoveryTickerActivity[];
  generatedAt: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeManagerCik(value: string): string | null {
  const digits = value.trim().replace(/\D/g, "");
  if (!digits || digits.length > 10) {
    return null;
  }

  return digits.padStart(10, "0");
}

function isNewerHolding(left: InstitutionalHolding, right: InstitutionalHolding | undefined): boolean {
  if (!right) {
    return true;
  }

  return `${left.reportDate}_${left.updatedAt}` > `${right.reportDate}_${right.updatedAt}`;
}

function isNewerChange(left: InstitutionalHoldingChange, right: InstitutionalHoldingChange | undefined): boolean {
  if (!right) {
    return true;
  }

  return `${left.reportDate}_${left.updatedAt}` > `${right.reportDate}_${right.updatedAt}`;
}

function latestChangeByManager(changes: InstitutionalHoldingChange[]): Map<string, InstitutionalHoldingChange> {
  const byManager = new Map<string, InstitutionalHoldingChange>();

  for (const change of changes) {
    const current = byManager.get(change.managerCik);
    if (
      isNewerChange(change, current) ||
      (change.reportDate === current?.reportDate && Math.abs(change.valueChangeUsd) > Math.abs(current.valueChangeUsd))
    ) {
      byManager.set(change.managerCik, change);
    }
  }

  return byManager;
}

function latestChangeByPosition(changes: InstitutionalHoldingChange[]): Map<string, InstitutionalHoldingChange> {
  const byPosition = new Map<string, InstitutionalHoldingChange>();

  for (const change of changes) {
    const current = byPosition.get(change.positionKey);
    if (isNewerChange(change, current)) {
      byPosition.set(change.positionKey, change);
    }
  }

  return byPosition;
}

function isChangeNewerThanHolding(change: InstitutionalHoldingChange, holding: InstitutionalHolding): boolean {
  return `${change.reportDate}_${change.updatedAt}` > `${holding.reportDate}_${holding.updatedAt}`;
}

function tickerPositionFromSoldOutChange(ticker: string, change: InstitutionalHoldingChange): InstitutionalTickerPosition {
  return {
    managerCik: change.managerCik,
    managerName: change.managerName,
    ticker,
    nameOfIssuer: change.nameOfIssuer,
    quarter: change.quarter,
    reportDate: change.reportDate,
    filingDate: change.filingDate,
    accessionNumber: change.accessionNumber,
    shares: 0,
    valueUsd: 0,
    positionCount: 0,
    changeStatus: change.status,
    shareChange: change.shareChange,
    valueChangeUsd: change.valueChangeUsd,
    percentChange: change.percentChange,
    updatedAt: change.updatedAt,
  };
}

function tickerActivityFromPosition(position: InstitutionalTickerPosition): InstitutionalTickerActivity | null {
  if (!position.changeStatus || position.valueChangeUsd === null || position.shareChange === null) {
    return null;
  }

  return {
    managerCik: position.managerCik,
    managerName: position.managerName,
    status: position.changeStatus,
    valueChangeUsd: position.valueChangeUsd,
    shareChange: position.shareChange,
    percentChange: position.percentChange,
    reportDate: position.reportDate,
    accessionNumber: position.accessionNumber,
  };
}

function normalizeDiscoveryManager(id: string, data: InstitutionalManagerDocument | undefined): InstitutionalDiscoveryManager {
  const cik = readString(data?.cik) ?? id;
  return {
    cik,
    name: readString(data?.name) ?? cik,
    latestAccessionNumber: readString(data?.latestAccessionNumber),
    latestReportDate: readString(data?.latestReportDate),
    latestQuarter: readString(data?.latestQuarter),
    updatedAt: readString(data?.updatedAt),
  };
}

function discoveryActivityFromChanges(changes: InstitutionalHoldingChange[]): InstitutionalDiscoveryTickerActivity[] {
  const byTicker = new Map<string, InstitutionalHoldingChange[]>();

  for (const change of changes) {
    if (!change.ticker) {
      continue;
    }

    byTicker.set(change.ticker, [...(byTicker.get(change.ticker) ?? []), change]);
  }

  return [...byTicker.entries()]
    .map(([ticker, tickerChanges]) => {
      const managerCiks = new Set(tickerChanges.map((change) => change.managerCik));
      const topManagers = [...tickerChanges]
        .sort((left, right) => Math.abs(right.valueChangeUsd) - Math.abs(left.valueChangeUsd))
        .slice(0, 3)
        .map((change) => ({
          managerCik: change.managerCik,
          managerName: change.managerName,
          status: change.status,
          valueChangeUsd: change.valueChangeUsd,
        }));

      return {
        ticker,
        nameOfIssuer: readString(tickerChanges[0]?.nameOfIssuer) ?? ticker,
        reportDate: tickerChanges.reduce((latest, change) => change.reportDate > latest ? change.reportDate : latest, ""),
        managerCount: managerCiks.size,
        netValueChangeUsd: tickerChanges.reduce((total, change) => total + change.valueChangeUsd, 0),
        grossValueChangeUsd: tickerChanges.reduce((total, change) => total + Math.abs(change.valueChangeUsd), 0),
        newManagers: tickerChanges.filter((change) => change.status === "NEW").length,
        increasedManagers: tickerChanges.filter((change) => change.status === "INCREASED").length,
        reducedManagers: tickerChanges.filter((change) => change.status === "REDUCED").length,
        soldOutManagers: tickerChanges.filter((change) => change.status === "SOLD_OUT").length,
        topManagers,
      };
    })
    .sort((left, right) => right.grossValueChangeUsd - left.grossValueChangeUsd)
    .slice(0, 12);
}

export async function getInstitutionalTickerSummary(
  rawTicker: string,
  limit = DEFAULT_TICKER_SCAN_LIMIT,
): Promise<InstitutionalTickerSummary> {
  const ticker = normalizeTicker(rawTicker);
  const db = getAdminFirestore();
  const [holdingsSnapshot, changesSnapshot] = await Promise.all([
    db
      .collection("institutional_holdings")
      .where("ticker", "==", ticker)
      .orderBy("reportDate", "desc")
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get(),
    db
      .collection("institutional_holding_changes")
      .where("ticker", "==", ticker)
      .orderBy("reportDate", "desc")
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get(),
  ]);
  const latestByManager = new Map<string, InstitutionalHolding>();

  for (const doc of holdingsSnapshot.docs) {
    const holding = doc.data() as InstitutionalHolding;
    if (holding.ticker !== ticker) {
      continue;
    }

    const current = latestByManager.get(holding.managerCik);
    if (isNewerHolding(holding, current)) {
      latestByManager.set(holding.managerCik, holding);
    }
  }

  const changes = changesSnapshot.docs
    .map((doc) => doc.data() as InstitutionalHoldingChange)
    .filter((change) => change.ticker === ticker);
  const changeByManager = latestChangeByManager(changes);
  const currentPositions = [...latestByManager.values()]
    .map<InstitutionalTickerPosition>((holding) => {
      const managerHoldings = holdingsSnapshot.docs
        .map((doc) => doc.data() as InstitutionalHolding)
        .filter((candidate) => (
          candidate.managerCik === holding.managerCik &&
          candidate.ticker === ticker &&
          candidate.reportDate === holding.reportDate
        ));
      const aggregateShares = managerHoldings.reduce((total, item) => total + item.shares, 0);
      const aggregateValueUsd = managerHoldings.reduce((total, item) => total + item.valueUsd, 0);
      const change = changeByManager.get(holding.managerCik) ?? null;
      const isSoldOut = change?.status === "SOLD_OUT" && isChangeNewerThanHolding(change, holding);

      return {
        managerCik: holding.managerCik,
        managerName: holding.managerName,
        ticker,
        nameOfIssuer: holding.nameOfIssuer,
        quarter: holding.quarter,
        reportDate: holding.reportDate,
        filingDate: holding.filingDate,
        accessionNumber: holding.accessionNumber,
        shares: isSoldOut ? 0 : aggregateShares,
        valueUsd: isSoldOut ? 0 : aggregateValueUsd,
        positionCount: isSoldOut ? 0 : managerHoldings.length,
        changeStatus: change?.status ?? null,
        shareChange: change?.shareChange ?? null,
        valueChangeUsd: change?.valueChangeUsd ?? null,
        percentChange: change?.percentChange ?? null,
        updatedAt: holding.updatedAt,
      };
    })
  const soldOutPositions = [...changeByManager.values()]
    .filter((change) => change.status === "SOLD_OUT" && !latestByManager.has(change.managerCik))
    .map((change) => tickerPositionFromSoldOutChange(ticker, change));
  const allPositions = [...currentPositions, ...soldOutPositions];
  const positions = allPositions
    .sort((left, right) => right.valueUsd - left.valueUsd || Math.abs(right.valueChangeUsd ?? 0) - Math.abs(left.valueChangeUsd ?? 0))
    .slice(0, 100);
  const activities = allPositions.flatMap((position) => {
    const activity = tickerActivityFromPosition(position);
    return activity ? [activity] : [];
  });
  const topBuyers = activities
    .filter((activity) => activity.valueChangeUsd > 0)
    .sort((left, right) => right.valueChangeUsd - left.valueChangeUsd)
    .slice(0, 5);
  const topSellers = activities
    .filter((activity) => activity.valueChangeUsd < 0)
    .sort((left, right) => left.valueChangeUsd - right.valueChangeUsd)
    .slice(0, 5);

  return {
    ticker,
    totalManagers: allPositions.length,
    totalValueUsd: allPositions.reduce((total, position) => total + position.valueUsd, 0),
    totalShares: allPositions.reduce((total, position) => total + position.shares, 0),
    netValueChangeUsd: activities.reduce((total, activity) => total + activity.valueChangeUsd, 0),
    increasedManagers: activities.filter((activity) => activity.status === "INCREASED").length,
    reducedManagers: activities.filter((activity) => activity.status === "REDUCED").length,
    newManagers: activities.filter((activity) => activity.status === "NEW").length,
    soldOutManagers: activities.filter((activity) => activity.status === "SOLD_OUT").length,
    latestReportDate: allPositions.reduce<string | null>((latest, position) => (
      !latest || position.reportDate > latest ? position.reportDate : latest
    ), null),
    topBuyers,
    topSellers,
    positions,
  };
}

export async function getInstitutionalDiscoverySummary(): Promise<InstitutionalDiscoverySummary> {
  const db = getAdminFirestore();
  const [managersSnapshot, changesSnapshot] = await Promise.all([
    db.collection("institutional_managers").orderBy("updatedAt", "desc").limit(DEFAULT_DISCOVERY_MANAGER_LIMIT).get(),
    db.collection("institutional_holding_changes").orderBy("updatedAt", "desc").limit(DEFAULT_DISCOVERY_ACTIVITY_LIMIT).get(),
  ]);
  const managers = managersSnapshot.docs.map((doc) => normalizeDiscoveryManager(doc.id, doc.data() as InstitutionalManagerDocument));
  const changes = changesSnapshot.docs.map((doc) => doc.data() as InstitutionalHoldingChange);

  return {
    managers,
    activeTickers: discoveryActivityFromChanges(changes),
    generatedAt: new Date().toISOString(),
  };
}

export async function getInstitutionalManagerSummary(rawCik: string): Promise<InstitutionalManagerSummary | null> {
  const managerCik = normalizeManagerCik(rawCik);
  if (!managerCik) {
    return null;
  }

  const db = getAdminFirestore();
  const managerSnapshot = await db.collection("institutional_managers").doc(managerCik).get();
  const managerData = managerSnapshot.data() as InstitutionalManagerDocument | undefined;
  const latestQuarter = readString(managerData?.latestQuarter);
  if (!managerSnapshot.exists || !latestQuarter) {
    return null;
  }

  const docPrefix = `${latestQuarter}_${managerCik}_`;
  const [holdingsSnapshot, changesSnapshot] = await Promise.all([
    db
      .collection("institutional_holdings")
      .where(FieldPath.documentId(), ">=", docPrefix)
      .where(FieldPath.documentId(), "<", `${docPrefix}\uf8ff`)
      .orderBy(FieldPath.documentId())
      .limit(DEFAULT_TICKER_SCAN_LIMIT)
      .get(),
    db
      .collection("institutional_holding_changes")
      .where(FieldPath.documentId(), ">=", docPrefix)
      .where(FieldPath.documentId(), "<", `${docPrefix}\uf8ff`)
      .orderBy(FieldPath.documentId())
      .limit(DEFAULT_TICKER_SCAN_LIMIT)
      .get(),
  ]);
  const changeByPosition = latestChangeByPosition(
    changesSnapshot.docs.map((doc) => doc.data() as InstitutionalHoldingChange),
  );
  const holdings = holdingsSnapshot.docs
    .map((doc) => doc.data() as InstitutionalHolding)
    .sort((left, right) => right.valueUsd - left.valueUsd)
    .slice(0, DEFAULT_MANAGER_DISPLAY_LIMIT)
    .map((holding) => {
      const change = changeByPosition.get(holding.positionKey) ?? null;
      return {
        ...holding,
        changeStatus: change?.status ?? null,
        shareChange: change?.shareChange ?? null,
        valueChangeUsd: change?.valueChangeUsd ?? null,
        percentChange: change?.percentChange ?? null,
      };
    });

  return {
    manager: {
      cik: managerCik,
      name: readString(managerData?.name) ?? managerCik,
      latestAccessionNumber: readString(managerData?.latestAccessionNumber),
      latestReportDate: readString(managerData?.latestReportDate),
      latestQuarter,
      updatedAt: readString(managerData?.updatedAt),
    },
    holdings,
  };
}
