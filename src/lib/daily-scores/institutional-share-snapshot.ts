import type { DailyInstitutionalMove } from "@/lib/daily-scores/service";

type SearchParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

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
