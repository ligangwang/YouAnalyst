/** Region of this canonical listing, never the issuer's headquarters. */
export type ExchangeRegion = 'US' | 'CN';
export function exchangeRegion(id: string): ExchangeRegion | null {
  if (/^US:[A-Z0-9][A-Z0-9.-]{0,15}$/.test(id)) return 'US';
  if (/^(XSHG|XSHE):[0-9]{6}$/.test(id)) return 'CN';
  // ORG identities do not represent a single exchange listing.
  return null;
}
