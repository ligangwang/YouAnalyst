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
  market?: string;
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

type ScoredSearchItem = {
  item: SearchItem;
  score: number;
};

type TickerDocument = {
  symbol?: unknown;
  symbolLower?: unknown;
  name?: unknown;
  nameLower?: unknown;
  exchange?: unknown;
  micCode?: unknown;
  type?: unknown;
  exchangePriority?: unknown;
  market?: unknown;
  active?: unknown;
  predictionSupported?: unknown;
};

type InstitutionalManagerDocument = {
  cik?: unknown;
  name?: unknown;
  nameLower?: unknown;
  latestReportDate?: unknown;
  latestQuarter?: unknown;
};

function normalizeQuery(raw: string | null): string {
  return (raw ?? "").normalize("NFKC").trim().replace(/^\$/, "").toLowerCase();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCikQuery(query: string): string | null {
  if (!/^\d{1,10}$/.test(query)) {
    return null;
  }

  return query.padStart(10, "0");
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
    market: readString(data.market) ?? "US",
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

  if (query.length > 32 || !/^[\p{L}\p{N}.:\-\s]+$/u.test(query)) {
    return NextResponse.json({ items: [] });
  }

  try {
    const db = getAdminFirestore();
    const prefixField = query.length === 1 && request.nextUrl.searchParams.get("scope") !== "all" ? "symbolPrefixes" : "searchPrefixes";
    const normalizedCik = normalizeCikQuery(query);
    const legacyNamePrefix = query.toUpperCase();
    const [tickerSnapshot, indexedInstitutionSnapshot, legacyInstitutionSnapshot, directInstitutionSnapshot] = await Promise.all([
      db
        .collection("companies")
        .where(prefixField, "array-contains", query)
        .limit(50)
        .get(),
      db.collection("institutional_managers").where("searchPrefixes", "array-contains", query).limit(50).get(),
      db
        .collection("institutional_managers")
        .orderBy("name")
        .startAt(legacyNamePrefix)
        .endAt(`${legacyNamePrefix}\uf8ff`)
        .limit(50)
        .get(),
      normalizedCik ? db.collection("institutional_managers").doc(normalizedCik).get() : Promise.resolve(null),
    ]);

    const tickerItems: ScoredSearchItem[] = tickerSnapshot.docs
      .filter(doc => !doc.data().status || ["PUBLISHED", "DIRECTORY"].includes(doc.data().status))
      .filter(doc => request.nextUrl.searchParams.get("scope") === "all" || (doc.data().market === "US" && doc.data().active === true && doc.data().predictionSupported === true))
      .map((doc) => toSearchItem(doc.id, doc.data()))
      .filter((item): item is NonNullable<ReturnType<typeof toSearchItem>> => Boolean(item))
      .sort((left, right) => {
        const scoreDelta = scoreTicker(right, query) - scoreTicker(left, query);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return left.symbol.localeCompare(right.symbol);
      })
      .slice(0, 50)
      .map((item) => ({
        item: {
          id: item.id,
          kind: item.kind,
          symbol: item.symbol,
          name: item.name,
          exchange: item.exchange,
          micCode: item.micCode,
          type: item.type,
          market: item.market,
        },
        score: scoreTicker(item, query),
      }));
    const institutionsByCik = new Map<string, InstitutionSearchItem>();
    for (const doc of [...indexedInstitutionSnapshot.docs, ...legacyInstitutionSnapshot.docs]) {
      const item = toInstitutionSearchItem(doc.id, doc.data());
      if (item) {
        institutionsByCik.set(item.cik, item);
      }
    }
    if (directInstitutionSnapshot?.exists) {
      const item = toInstitutionSearchItem(directInstitutionSnapshot.id, directInstitutionSnapshot.data() as InstitutionalManagerDocument);
      if (item) {
        institutionsByCik.set(item.cik, item);
      }
    }

    const institutionItems: ScoredSearchItem[] = [...institutionsByCik.values()]
      .filter((item): item is InstitutionSearchItem => Boolean(item))
      .map((item) => ({ item, score: scoreInstitution(item, query) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
      .slice(0, limit);
    let selectedItems = [...tickerItems, ...institutionItems]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.item.kind !== right.item.kind) {
          return left.item.kind === "ticker" ? -1 : 1;
        }
        return left.item.name.localeCompare(right.item.name);
      })
      .slice(0, limit);

    if (institutionItems.length > 0 && limit > 1 && !selectedItems.some(({ item }) => item.kind === "institution")) {
      selectedItems = [...selectedItems.slice(0, limit - 1), institutionItems[0]].sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (left.item.kind !== right.item.kind) {
          return left.item.kind === "ticker" ? -1 : 1;
        }
        return left.item.name.localeCompare(right.item.name);
      });
    }

    const items: SearchItem[] = selectedItems.map(({ item }) => item);

    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search tickers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
