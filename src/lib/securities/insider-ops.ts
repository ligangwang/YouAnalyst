import { getAdminFirestore } from "@/lib/firebase/admin";

type InsiderFilingStatus = "PROCESSING" | "PARSED" | "FAILED";

export type InsiderOpsRecentFiling = {
  accessionNumber: string;
  filingDate: string | null;
  form: string | null;
  indexCik: string | null;
  indexCompanyName: string | null;
  status: string | null;
  transactionsWritten: number;
  lastError: string | null;
  parsedAt: string | null;
  updatedAt: string | null;
};

export type InsiderOpsRecentTransaction = {
  id: string;
  accessionNumber: string | null;
  ticker: string | null;
  issuerName: string | null;
  reportingOwnerName: string | null;
  transactionCode: string | null;
  transactionDate: string | null;
  shares: number | null;
  pricePerShare: number | null;
  valueUsd: number | null;
  filingDate: string | null;
  updatedAt: string | null;
};

export type InsiderOpsSummary = {
  filings: {
    statuses: Record<InsiderFilingStatus, number>;
    totalTracked: number;
  };
  recentFilings: InsiderOpsRecentFiling[];
  recentFailures: InsiderOpsRecentFiling[];
  recentTransactions: InsiderOpsRecentTransaction[];
  generatedAt: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function filingFromDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): InsiderOpsRecentFiling {
  return {
    accessionNumber: readString(doc.get("accessionNumber")) ?? doc.id,
    filingDate: readString(doc.get("filingDate")),
    form: readString(doc.get("form")),
    indexCik: readString(doc.get("indexCik")),
    indexCompanyName: readString(doc.get("indexCompanyName")),
    status: readString(doc.get("status")),
    transactionsWritten: readNumber(doc.get("transactionsWritten")) ?? 0,
    lastError: readString(doc.get("lastError")),
    parsedAt: readString(doc.get("parsedAt")),
    updatedAt: readString(doc.get("updatedAt")),
  };
}

function transactionFromDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): InsiderOpsRecentTransaction {
  return {
    id: doc.id,
    accessionNumber: readString(doc.get("accessionNumber")),
    ticker: readString(doc.get("ticker")),
    issuerName: readString(doc.get("issuerName")),
    reportingOwnerName: readString(doc.get("reportingOwnerName")),
    transactionCode: readString(doc.get("transactionCode")),
    transactionDate: readString(doc.get("transactionDate")),
    shares: readNumber(doc.get("shares")),
    pricePerShare: readNumber(doc.get("pricePerShare")),
    valueUsd: readNumber(doc.get("valueUsd")),
    filingDate: readString(doc.get("filingDate")),
    updatedAt: readString(doc.get("updatedAt")),
  };
}

async function countStatus(status: InsiderFilingStatus): Promise<number> {
  const snapshot = await getAdminFirestore()
    .collection("sec_insider_filings")
    .where("status", "==", status)
    .count()
    .get();

  return snapshot.data().count;
}

export async function getInsiderOpsSummary(): Promise<InsiderOpsSummary> {
  const db = getAdminFirestore();
  const [processing, parsed, failed, recentFilingsSnapshot, recentFailuresSnapshot, recentTransactionsSnapshot] = await Promise.all([
    countStatus("PROCESSING"),
    countStatus("PARSED"),
    countStatus("FAILED"),
    db.collection("sec_insider_filings").orderBy("updatedAt", "desc").limit(25).get(),
    db.collection("sec_insider_filings").where("status", "==", "FAILED").orderBy("updatedAt", "desc").limit(10).get(),
    db.collection("insider_transactions").orderBy("updatedAt", "desc").limit(25).get(),
  ]);

  return {
    filings: {
      statuses: {
        PROCESSING: processing,
        PARSED: parsed,
        FAILED: failed,
      },
      totalTracked: processing + parsed + failed,
    },
    recentFilings: recentFilingsSnapshot.docs.map(filingFromDoc),
    recentFailures: recentFailuresSnapshot.docs.map(filingFromDoc),
    recentTransactions: recentTransactionsSnapshot.docs.map(transactionFromDoc),
    generatedAt: new Date().toISOString(),
  };
}
