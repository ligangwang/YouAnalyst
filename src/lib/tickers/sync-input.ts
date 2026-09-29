export function tickerSyncInput(body: unknown) {
  if (!body || typeof body !== "object") throw Error("Choose preview or sync.");
  const b = body as Record<string, unknown>;
  if (typeof b.dryRun !== "boolean") throw Error("Choose preview or sync.");
  const field = (key: string, fallback: string) => {
    if (b[key] === undefined) return fallback;
    if (typeof b[key] !== "string" || !b[key].trim() || b[key].length > 120) throw Error(`Invalid ${key}.`);
    return b[key].trim();
  };
  const country = field("country", "United States"), currency = field("currency", "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw Error("Use a three-letter currency code.");
  if (b.limit !== undefined && (!Number.isInteger(b.limit) || Number(b.limit) < 1 || Number(b.limit) > 50000)) throw Error("Limit must be 1–50000, or blank for all.");
  if (b.types !== undefined && (!Array.isArray(b.types) || !b.types.length || b.types.length > 20 || b.types.some(t => typeof t !== "string" || !t.trim() || t.length > 100))) throw Error("Invalid security types.");
  return { dryRun: b.dryRun, country, currency, limit: b.limit as number | undefined, types: b.types as string[] | undefined };
}

