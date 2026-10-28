import {instrumentId, instrumentType, type InstrumentType} from '@/lib/instruments/model';
import { COMPANY_SEARCH_VERSION } from '@/lib/market-companies/search';
import { loadCollectionUniverse } from '@/lib/company-themes/service';
import { changeCached } from '@/lib/change-cache';
import { reviewedCompanyNames } from '@/lib/market-companies/reviewed-names';
import { companyPinyinTerms, normalizeStockQuery, stockNameTerms } from "@/lib/market-companies/pinyin-search";
import { predictionInstrument } from "@/lib/predictions/instrument";
import { NVIDIA_EDITORIAL_COMPANIES } from "@/lib/research/nvidia-manufacturing";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { NextRequest, NextResponse } from "next/server";
import {withCompanyPageReads} from '@/lib/local-cache/company-page-scope';
import {withSearchEntityReads} from '@/lib/local-cache/company-directory';
import {withSourceCache} from '@/lib/local-cache/read-scope';
import type {Instrument} from '@/lib/instruments/model';
import {companySupportState,type CompanySupportState} from '@/lib/instrument-onboarding/search-state';
import {isCollectionCompany} from '@/lib/company-themes/model';

type TickerSearchItem = {
  hasThemes?: boolean;
  supportState?: CompanySupportState;
  instrumentId?: string; companyId?: string; instrumentType?: InstrumentType;
  slug?: string;
  id: string;
  kind: "ticker";
  symbol: string;
  name: string;
  exchange: string | null;
  micCode: string | null;
  type: string | null;
  market?: string;
};

type SearchItem = TickerSearchItem;

type ScoredSearchItem = {
  item: SearchItem;
  score: number;
};

type TickerDocument = {
  supersededByCompanyId?: unknown; listingStatus?: unknown;
  slug?: unknown;
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
  names?: unknown;
  aliases?: unknown;
  searchTerms?: unknown;
};

function normalizeQuery(raw: string | null): string {
  return normalizeStockQuery(raw ?? "");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scoreTicker(item: TickerSearchItem & { symbolLower: string; nameLower: string; exchangePriority: number; searchNames: string[] }, query: string): number {
  let score = item.exchangePriority;

  if (item.id.toLowerCase() === query) score += 1000;

  if (item.symbolLower === query) {
    score += 1000;
  } else if (item.symbolLower.startsWith(query)) {
    score += 700;
  }

  if (item.searchNames.includes(query) || item.searchNames.includes(query.replace(/\s+/g, ""))) {
    score += 500;
  } else if (item.searchNames.some(name => name.startsWith(query) || name.startsWith(query.replace(/\s+/g, "")))) {
    score += 350;
  } else if (item.searchNames.some(name => name.split(/\s+/).some(token => token.startsWith(query)))) {
    score += 250;
  }

  return score;
}

function toSearchItem(id: string, data: TickerDocument) {
  const symbol = readString(data.symbol) ?? (data.market === "GLOBAL" ? id : null);
  const name = readString(data.name);

  if (!symbol || !name) {
    return null;
  }

  const symbolLower = readString(data.symbolLower) ?? symbol.toLowerCase();
  const nameLower = readString(data.nameLower) ?? name.toLowerCase();
  const exchangePriority = typeof data.exchangePriority === "number" ? data.exchangePriority : 0;

  return {
    id,
    supportState: undefined as CompanySupportState | undefined,
    companyId: readString(data.supersededByCompanyId) ?? id,
    ...(/^(US:[A-Z0-9.-]+|XSHG:\d{6}|XSHE:\d{6}|XBSE:\d{6})$/.test(id) && data.listingStatus !== 'PRIVATE' ? {instrumentId:instrumentId(id),instrumentType:instrumentType(data.type)} : {}),
    kind: "ticker" as const,
    ...(readString(data.slug)?{slug:readString(data.slug)!}:{}),
    symbol,
    symbolLower,
    name,
    names: reviewedCompanyNames(id, name, data.names),
    nameLower,
    searchNames: [...stockNameTerms(data as Record<string, unknown>), ...(Array.isArray(data.searchTerms) ? data.searchTerms.filter((value): value is string => typeof value === "string") : [])],
    exchange: readString(data.exchange),
    micCode: readString(data.micCode),
    type: readString(data.type),
    exchangePriority,
    market: readString(data.market) ?? "US",
  };
}

export async function GET(request: NextRequest) {
  // Indexed autocomplete and support-state lookups are bounded reads. Loading
  // the bulk directory here delays the first keystroke and scans prefix arrays.
  // Keep the covered graph's separate cache policy unchanged.
  return request.nextUrl.searchParams.get('scope') === 'covered'
    ? search(request)
    : withSearchEntityReads(() => withSourceCache(() => search(request)));
}

async function search(request: NextRequest) {
  const query = normalizeQuery(request.nextUrl.searchParams.get("q"));
  const nameLocale = /\p{Script=Han}/u.test(query) ? 'zh-CN' : /[a-z]/i.test(query) ? 'en' : null;
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(Math.trunc(limitParam), 20)) : 10;

  const coveredOnly = request.nextUrl.searchParams.get('scope') === 'covered';
  const directory = request.nextUrl.searchParams.get('scope') === 'directory';
  if (query.length === 0 && !coveredOnly) {
    return NextResponse.json({ items: [] });
  }

  if (query.length > 120 || (query.length > 0 && !/^[\p{L}\p{N}.:\-\s&'’()*]+$/u.test(query))) {
    return NextResponse.json({ items: [] });
  }

  try {
    if (coveredOnly) {
      const db = getAdminFirestore();
      const companies = await withCompanyPageReads(()=>changeCached(db, 'covered-company-search', ['companies', 'company_relationships', 'directory_syncs'], async () => {
        const graph = await loadCollectionUniverse(db);
        return graph.nodes.filter(node => node.kind === 'COMPANY');
      }));
      const compact = query.replace(/\s+/g, '');
      const items = !query ? [] : companies
        .map(company => toSearchItem(company.id, { ...company, searchTerms: companyPinyinTerms(company) }))
        .filter((item): item is NonNullable<ReturnType<typeof toSearchItem>> => Boolean(item))
        .filter(item => item.id.toLowerCase().includes(query) || item.symbolLower.includes(query) || item.searchNames.some(name => name.includes(query) || name.replace(/\s+/g, '').includes(compact)))
        .sort((left, right) => scoreTicker(right, query) - scoreTicker(left, query) || left.name.localeCompare(right.name))
        .slice(0, limit)
        .map(item => ({ id: item.id, instrumentId:item.instrumentId, companyId:item.companyId, instrumentType:item.instrumentType, kind: item.kind, symbol: item.symbol, name: nameLocale ? item.names[nameLocale] || item.name : item.name,
          ...(item.slug ? { slug: item.slug } : {}), exchange: item.exchange, micCode: item.micCode, type: item.type, market: item.market }));
      return NextResponse.json({ items, total: companies.length }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const db = getAdminFirestore();
    const collection = db.collection("companies");
    const indexed = collection.select('supersededByCompanyId','isDeleted','slug','symbol','symbolLower','name','nameLower','names','aliases','legalName','searchTerms','exchange','micCode','type','exchangePriority','market','active','predictionSupported','status','listingStatus',...(directory?['onboarding','cik','themeMemberships','inGraph']:[]));
    // Return ranking/display metadata, not the potentially large prefix array.
    // Scalar symbol range keeps partial codes ahead of a full page of name matches.
    const symbolSearch = indexed.where('symbolLower', '>=', query).where('symbolLower', '<=', query + '\uf8ff').limit(50).get();
    const nameSearch = query.length === 1 && !directory && request.nextUrl.searchParams.get('scope') !== 'all'
      ? symbolSearch
      : indexed.where('searchPrefixes', 'array-contains', query.replace(/\s+/g, '').slice(0,32)).limit(50).get();
    const [nameSnapshot, symbolSnapshot, exactSnapshot] = await Promise.all([
      nameSearch, symbolSearch, indexed.where('symbolLower', '==', query).limit(20).get(),
    ]);
    const candidateDocs = [...new Map([...nameSnapshot.docs, ...symbolSnapshot.docs, ...exactSnapshot.docs].map(doc => [doc.id, doc])).values()];

    const editorialDocs: { id: string; data: () => Record<string, unknown> }[] = [];
    // Research discovery only. Do not fabricate tradeable/prediction-enabled instruments.
    // Exact reads keep hidden or invalid remote records authoritative even when search indexes omit them.
    if (request.nextUrl.searchParams.get("scope") === "all") {
      const candidates = NVIDIA_EDITORIAL_COMPANIES.filter(company => [company.symbol, company.name, ...Object.values(company.names as Record<string, string> ?? {})]
        .some(value => typeof value === "string" && value.toLowerCase().split(/\s+/).some((_, i, words) => words.slice(i).join(" ").startsWith(query))));
      for (const company of candidates) {
        const existing = await db.collection("companies").doc(company.id).get();
        if (!existing.exists && !candidateDocs.some(doc => doc.id === company.id)) editorialDocs.push({ id: company.id, data: () => ({ ...company, market: company.id.startsWith("US:") ? "US" : "GLOBAL" }) });
      }
    }

    const tickerItems: ScoredSearchItem[] = [...candidateDocs, ...editorialDocs]
      .filter(doc => doc.data().isDeleted !== true)
      .filter(doc => !doc.data().status || ["PUBLISHED", "DIRECTORY"].includes(doc.data().status))
      .filter(doc => directory || request.nextUrl.searchParams.get("scope") === "all" || (doc.data().listingStatus !== "PRIVATE" && ((doc.data().market === "US" && doc.data().active === true && doc.data().predictionSupported === true) || (request.nextUrl.searchParams.get("scope") === "calls" && predictionInstrument(doc.id)?.market === "CN_A"))))
      .map((doc) => toSearchItem(doc.id,doc.data()))
      .filter((item): item is NonNullable<ReturnType<typeof toSearchItem>> => Boolean(item))
      .filter(item => query.length <= 32 || item.searchNames.some(name => name.includes(query) || name.replace(/\s+/g, "").includes(query.replace(/\s+/g, ""))))
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
          ...(directory?{supportState:item.supportState}:{}),
          hasThemes:undefined as boolean|undefined,
          instrumentId:item.instrumentId, companyId:item.companyId, instrumentType:item.instrumentType,
          kind: item.kind,
          symbol: item.symbol,
          name: nameLocale ? item.names[nameLocale] || item.name : item.name,
          ...(item.slug?{slug:item.slug}:{}),
          exchange: item.exchange,
          micCode: item.micCode,
          type: item.type,
          market: item.market,
        },
        score: scoreTicker(item, query),
      }));
    const items = tickerItems.slice(0, limit).map(({ item }) => item);
    if(directory){
      const stockItems=items.filter(item=>item.instrumentId);
      const instruments=stockItems.length?await db.getAll(...stockItems.map(item=>db.collection('instruments').doc(item.instrumentId!))):[];
      const records=new Map(instruments.map(doc=>[doc.id,doc.data() as Instrument|undefined]));
      const sources=new Map(candidateDocs.map(doc=>[doc.id,doc.data()]));
      const ownerIds=[...new Set(stockItems.map(item=>records.get(item.instrumentId!)?.companyId??item.companyId).filter((id):id is string=>Boolean(id)&&!sources.has(id!)))];
      const owners=ownerIds.length?await db.getAll(...ownerIds.map(id=>db.collection('companies').doc(id))):[];
      for(const doc of owners)sources.set(doc.id,doc.data()??{});
      for(const item of items){
        const source=sources.get(item.id)??{},record=item.instrumentId?records.get(item.instrumentId):undefined;
        const companyId=record?.companyId??item.companyId;
        item.supportState=companySupportState(item.id,source,record,companyId?sources.get(companyId):undefined);
        item.hasThemes=isCollectionCompany({...((companyId?sources.get(companyId):undefined)??source),id:companyId??item.id});
        if(companyId)item.companyId=companyId;
      }
    }


    return NextResponse.json({ items }, { headers: { 'X-Company-Search-Version': String(COMPANY_SEARCH_VERSION),...(directory?{'Cache-Control':'no-store'}:{}) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search tickers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
