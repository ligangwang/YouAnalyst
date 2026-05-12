import { getAdminFirestore } from "@/lib/firebase/admin";
import { normalizeTicker } from "@/lib/predictions/types";
import { NextRequest, NextResponse } from "next/server";

type InsiderTransactionItem = {
  id: string;
  accessionNumber: string | null;
  filingDate: string | null;
  form: string | null;
  issuerCik: string | null;
  issuerName: string | null;
  ticker: string;
  reportingOwnerName: string | null;
  relationship: {
    isDirector?: boolean;
    isOfficer?: boolean;
    isTenPercentOwner?: boolean;
    officerTitle?: string | null;
  } | null;
  securityTitle: string | null;
  transactionDate: string | null;
  transactionCode: string | null;
  acquiredDisposedCode: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  valueUsd: number | null;
  sharesOwnedFollowing: number | null;
  directOrIndirectOwnership: "D" | "I" | null;
};

function parseLimit(raw: string | null): number {
  const parsed = Number(raw ?? "25");
  if (!Number.isFinite(parsed)) {
    return 25;
  }

  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOwnershipCode(value: unknown): "D" | "I" | null {
  return value === "D" || value === "I" ? value : null;
}

function readAcquiredDisposedCode(value: unknown): "A" | "D" | null {
  return value === "A" || value === "D" ? value : null;
}

function mapTransaction(doc: FirebaseFirestore.QueryDocumentSnapshot, ticker: string): InsiderTransactionItem {
  const relationship = doc.get("relationship");
  const relationshipData = relationship && typeof relationship === "object"
    ? relationship as InsiderTransactionItem["relationship"]
    : null;

  return {
    id: doc.id,
    accessionNumber: readString(doc.get("accessionNumber")),
    filingDate: readString(doc.get("filingDate")),
    form: readString(doc.get("form")),
    issuerCik: readString(doc.get("issuerCik")),
    issuerName: readString(doc.get("issuerName")),
    ticker,
    reportingOwnerName: readString(doc.get("reportingOwnerName")),
    relationship: relationshipData,
    securityTitle: readString(doc.get("securityTitle")),
    transactionDate: readString(doc.get("transactionDate")),
    transactionCode: readString(doc.get("transactionCode")),
    acquiredDisposedCode: readAcquiredDisposedCode(doc.get("acquiredDisposedCode")),
    shares: readNumber(doc.get("shares")),
    pricePerShare: readNumber(doc.get("pricePerShare")),
    valueUsd: readNumber(doc.get("valueUsd")),
    sharesOwnedFollowing: readNumber(doc.get("sharesOwnedFollowing")),
    directOrIndirectOwnership: readOwnershipCode(doc.get("directOrIndirectOwnership")),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  const normalizedTicker = normalizeTicker(ticker);
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  if (!normalizedTicker) {
    return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
  }

  try {
    const snapshot = await getAdminFirestore()
      .collection("insider_transactions")
      .where("ticker", "==", normalizedTicker)
      .orderBy("transactionDate", "desc")
      .limit(limit)
      .get();
    const items = snapshot.docs
      .map((doc) => mapTransaction(doc, normalizedTicker));

    return NextResponse.json({
      ticker: normalizedTicker,
      items,
      count: items.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load insider transactions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
