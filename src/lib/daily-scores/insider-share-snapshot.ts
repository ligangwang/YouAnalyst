import type { DailyInsiderMove } from "@/lib/daily-scores/service";

type SnapshotTuple = [string, string, "P" | "S", number, number, number, number, string];

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

function tupleFromMove(move: DailyInsiderMove): SnapshotTuple {
  return [
    move.issuerName,
    move.filingDate,
    move.transactionCode,
    move.totalValueUsd,
    move.totalShares,
    move.insiderCount,
    move.transactionCount,
    move.latestTransactionDate,
  ];
}

function moveFromTuple(value: unknown, ticker: string): DailyInsiderMove | null {
  if (!Array.isArray(value) || value.length !== 8) {
    return null;
  }

  const [issuerName, filingDate, transactionCode, totalValueUsd, totalShares, insiderCount, transactionCount, latestTransactionDate] = value;
  if (
    typeof issuerName !== "string" ||
    typeof filingDate !== "string" ||
    typeof latestTransactionDate !== "string" ||
    (transactionCode !== "P" && transactionCode !== "S")
  ) {
    return null;
  }

  const numbers = [totalValueUsd, totalShares, insiderCount, transactionCount].map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) {
    return null;
  }

  return {
    ticker: ticker.trim().toUpperCase(),
    issuerName,
    filingDate,
    transactionCode,
    totalValueUsd: numbers[0],
    totalShares: numbers[1],
    insiderCount: numbers[2],
    transactionCount: numbers[3],
    latestTransactionDate,
  };
}

export function insiderMoveSnapshotSegment(move: DailyInsiderMove): string {
  return utf8ToBase64Url(JSON.stringify(tupleFromMove(move)));
}

export function insiderMoveFromSnapshotSegment(segment: string | null | undefined, ticker: string): DailyInsiderMove | null {
  if (!segment?.trim()) {
    return null;
  }

  const candidates: string[] = [];
  try {
    candidates.push(base64UrlToUtf8(segment));
  } catch {
    // Older shared URLs may use raw URI-encoded JSON.
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
