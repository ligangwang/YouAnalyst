import { getAdminFirestore } from "@/lib/firebase/admin";
import { NextRequest, NextResponse } from "next/server";

type TickerSearchItem = {
  id: string;
  kind: "ticker";
  symbol: string;
  name: string;
  exchange: string | null;
  micCode: string | null;
  type: string | null;
};

type InstitutionSearchItem = {
  id: string;
  kind: "institution";
  cik: string;
  name: string;
  latestReportDate: string | null;
  latestQuarter: string | null;
};

type SearchItem = TickerSearchItem | InstitutionSearchItem;

type TickerDocument = {
  symbol?: unknown;
  symbolLower?: unknown;
  name?: unknown;
  nameLower?: unknown;
  exchange?: unknown;
  micCode?: unknown;
  type?: unknown;
  exchangePriority?: unknown;
};

type InstitutionalManagerDocument = {
  cik?: unknown;
  name?: unknown;
  latestReportDate?: unknown;
  latestQuarter?: unknown;
};

function normalizeQuery(raw: string | null): string {
  return (raw ?? "").trim().replace(/^\$/, "").toLowerCase();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scoreTicker(item: TickerSearchItem & { symbolLower: string; nameLower: string; exchangePriority: number }, query: string): number {
  let score = item.exchangePriority;

  if (item.symbolLower === query) {
    score += 1000;
  } else if (item.symbolLower.startsWith(query)) {
    score += 700;
  }

  if (item.nameLower === query) {
    score += 500;
  } else if (item.nameLower.startsWith(query)) {
    score += 350;
  } else if (item.nameLower.split(/\s+/).some((token) => token.startsWith(query))) {
    score += 250;
  }

  return score;
}

function scoreInstitution(item: InstitutionSearchItem, query: string): number {
  const nameLower = item.name.toLowerCase();
  const cik = item.cik.replace(/^0+/, "") || item.cik;
  let score = 0;

  if (item.cik === query || cik === query) {
    score += 900;
  }

  if (nameLower === query) {
    score += 650;
  } else if (nameLower.startsWith(query)) {
    score += 450;
  } else if (nameLower.split(/\s+/).some((token) => token.startsWith(query))) {
    score += 300;
  } else if (nameLower.includes(query)) {
    score += 150;
  }

  return score;
}

function toSearchItem(id: string, data: TickerDocument) {
  const symbol = readString(data.symbol);
  const name = readString(data.name);

  if (!symbol || !name) {
    return null;
  }

  const symbolLower = readString(data.symbolLower) ?? symbol.toLowerCase();
  const nameLower = readString(data.nameLower) ?? name.toLowerCase();
  const exchangePriority = typeof data.exchangePriority === "number" ? data.exchangePriority : 0;

  return {
    id,
    kind: "ticker" as const,
    symbol,
    symbolLower,
    name,
    nameLower,
    exchange: readString(data.exchange),
    micCode: readString(data.micCode),
    type: readString(data.type),
    exchangePriority,
  };
}

function toInstitutionSearchItem(id: string, data: InstitutionalManagerDocument): InstitutionSearchItem | null {
  const cik = readString(data.cik) ?? id;
  const name = readString(data.name);

  if (!cik || !name) {
    return null;
  }

  return {
    id,
    kind: "institution",
    cik,
    name,
    latestReportDate: readString(data.latestReportDate),
    latestQuarter: readString(data.latestQuarter),
  };
}

export async function GET(request: NextRequest) {
  const query = normalizeQuery(request.nextUrl.searchParams.get("q"));
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(Math.trunc(limitParam), 20)) : 10;

  if (query.length === 0) {
    return NextResponse.json({ items: [] });
  }

  if (query.length > 32 || !/^[a-z0-9.\-\s]+$/.test(query)) {
    return NextResponse.json({ items: [] });
  }

  try {
    const db = getAdminFirestore();
    const prefixField = query.length === 1 ? "symbolPrefixes" : "searchPrefixes";
    const [tickerSnapshot, institutionSnapshot] = await Promise.all([
      db
        .collection("tickers")
        .where("active", "==", true)
        .where("predictionSupported", "==", true)
        .where(prefixField, "array-contains", query)
        .limit(50)
        .get(),
      db.collection("institutional_managers").orderBy("updatedAt", "desc").limit(200).get(),
    ]);

    const tickerItems = tickerSnapshot.docs
      .map((doc) => toSearchItem(doc.id, doc.data()))
      .filter((item): item is NonNullable<ReturnType<typeof toSearchItem>> => Boolean(item))
      .sort((left, right) => {
        const scoreDelta = scoreTicker(right, query) - scoreTicker(left, query);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return left.symbol.localeCompare(right.symbol);
      })
      .slice(0, limit)
      .map<TickerSearchItem>((item) => ({
        id: item.id,
        kind: item.kind,
        symbol: item.symbol,
        name: item.name,
        exchange: item.exchange,
        micCode: item.micCode,
        type: item.type,
      }));
    const institutionItems = institutionSnapshot.docs
      .map((doc) => toInstitutionSearchItem(doc.id, doc.data()))
      .filter((item): item is InstitutionSearchItem => Boolean(item))
      .map((item) => ({ item, score: scoreInstitution(item, query) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
      .slice(0, limit)
      .map(({ item }) => item);
    const items: SearchItem[] = [...tickerItems, ...institutionItems]
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "ticker" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, limit);

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search tickers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
