export function chinaCompanyId(value: string): string | null {
  const id = value.trim().toUpperCase();
  if (/^(XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id)) return id;
  if (/^[036]\d{5}$/.test(id)) return `${id[0] === "6" ? "XSHG" : "XSHE"}:${id}`;
  return null;
}

export function companyPageUrl(symbol: string, market?: string): string {
  const cn = market === "CN_A" ? chinaCompanyId(symbol) : null;
  return `/ticker/${cn ?? encodeURIComponent(symbol)}`;
}
