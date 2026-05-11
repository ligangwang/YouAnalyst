import type { DailyInstitutionalMove } from "@/lib/daily-scores/service";

type SearchParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

type SnapshotTuple = [string, string, number, number, number, number, number, number, number];

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToUtf8(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function firstParam(params: SearchParamSource, key: string): string | null {
  if (params instanceof URLSearchParams) {
    const value = params.get(key);
    return value && value.trim() ? value.trim() : null;
  }

  const value = params[key];
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.trim() ? candidate.trim() : null;
}

function finiteNumber(params: SearchParamSource, key: string): number | null {
  const value = firstParam(params, key);
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function appendInstitutionalMoveSnapshotParams(params: URLSearchParams, move: DailyInstitutionalMove): void {
  params.set("issuer", move.nameOfIssuer);
  params.set("reportDate", move.reportDate);
  params.set("managerCount", String(move.managerCount));
  params.set("valueChangeUsd", String(move.valueChangeUsd));
  params.set("shareChange", String(move.shareChange));
  params.set("newManagers", String(move.newManagers));
  params.set("increasedManagers", String(move.increasedManagers));
  params.set("reducedManagers", String(move.reducedManagers));
  params.set("soldOutManagers", String(move.soldOutManagers));
}

function tupleFromMove(move: DailyInstitutionalMove): SnapshotTuple {
  return [
    move.nameOfIssuer,
    move.reportDate,
    move.managerCount,
    move.valueChangeUsd,
    move.shareChange,
    move.newManagers,
    move.increasedManagers,
    move.reducedManagers,
    move.soldOutManagers,
  ];
}

function moveFromTuple(value: unknown, ticker: string): DailyInstitutionalMove | null {
  if (!Array.isArray(value) || value.length !== 9) {
    return null;
  }

  const [nameOfIssuer, reportDate, managerCount, valueChangeUsd, shareChange, newManagers, increasedManagers, reducedManagers, soldOutManagers] = value;
  if (typeof nameOfIssuer !== "string" || typeof reportDate !== "string") {
    return null;
  }

  const numbers = [managerCount, valueChangeUsd, shareChange, newManagers, increasedManagers, reducedManagers, soldOutManagers].map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) {
    return null;
  }

  return {
    ticker: ticker.trim().toUpperCase(),
    nameOfIssuer,
    reportDate,
    managerCount: numbers[0],
    valueChangeUsd: numbers[1],
    shareChange: numbers[2],
    newManagers: numbers[3],
    increasedManagers: numbers[4],
    reducedManagers: numbers[5],
    soldOutManagers: numbers[6],
  };
}

export function institutionalMoveSnapshotSegment(move: DailyInstitutionalMove): string {
  return utf8ToBase64Url(JSON.stringify(tupleFromMove(move)));
}

export function institutionalMoveFromSnapshotSegment(segment: string | null | undefined, ticker: string): DailyInstitutionalMove | null {
  if (!segment?.trim()) {
    return null;
  }

  const candidates: string[] = [];
  try {
    candidates.push(base64UrlToUtf8(segment));
  } catch {
    // Older shared URLs used URI-encoded JSON below.
  }

  candidates.push(segment);
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded !== segment) {
      candidates.push(decoded);
    }
  } catch {
    // Keep the raw candidate below.
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const move = moveFromTuple(parsed, ticker);
      if (move) {
        return move;
      }
    } catch {
      // Try the next representation.
    }
  }

  return null;
}

export function institutionalMoveFromShareParams(
  params: SearchParamSource,
  ticker: string,
): DailyInstitutionalMove | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const nameOfIssuer = firstParam(params, "issuer");
  const reportDate = firstParam(params, "reportDate");
  const managerCount = finiteNumber(params, "managerCount");
  const valueChangeUsd = finiteNumber(params, "valueChangeUsd");
  const shareChange = finiteNumber(params, "shareChange");
  const newManagers = finiteNumber(params, "newManagers");
  const increasedManagers = finiteNumber(params, "increasedManagers");
  const reducedManagers = finiteNumber(params, "reducedManagers");
  const soldOutManagers = finiteNumber(params, "soldOutManagers");

  if (
    !normalizedTicker ||
    !nameOfIssuer ||
    !reportDate ||
    managerCount === null ||
    valueChangeUsd === null ||
    shareChange === null ||
    newManagers === null ||
    increasedManagers === null ||
    reducedManagers === null ||
    soldOutManagers === null
  ) {
    return null;
  }

  return {
    ticker: normalizedTicker,
    nameOfIssuer,
    reportDate,
    managerCount,
    valueChangeUsd,
    shareChange,
    newManagers,
    increasedManagers,
    reducedManagers,
    soldOutManagers,
  };
}
