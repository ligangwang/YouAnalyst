export const COMPANY_COLLECTION = "companies";
export function companyFields(id: string, data: Record<string, unknown>) {
  const symbol = String(data.symbol ?? id.split(":").at(-1) ?? "");
  const name = String(data.name ?? symbol);
  const market = id.startsWith("US:") ? "US" : "CN_A";
  const normalized = (s: string) => s.normalize("NFKC").toLowerCase();
  const prefixes = new Set<string>();
  for (const word of [id, symbol, name, ...name.split(/[\s.,&-]+/)]) {
    const value = normalized(word);
    for (let start = 0; start < value.length; start++) {
      for (let size = 1; size <= Math.min(32, value.length - start); size++) prefixes.add(value.slice(start, start + size));
    }
  }
  return { id, market, symbol, name, symbolLower: normalized(symbol), nameLower: normalized(name), searchPrefixes: [...prefixes].slice(0, 4000),
    symbolPrefixes: Array.from({length:symbol.length}, (_, i) => normalized(symbol.slice(0,i+1))) };
}
