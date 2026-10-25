import {createHash} from 'node:crypto';

export const INSTRUMENT_TYPES = ['COMMON_SHARE', 'PREFERRED_SHARE', 'DEPOSITARY_RECEIPT', 'OTHER_EQUITY'] as const;
export type InstrumentType = typeof INSTRUMENT_TYPES[number];
export type Instrument = {
  onboarding?: import('../company-support/model').CompanyOnboarding;
  companyId: string; name: string; symbol: string;
  instrumentType?: InstrumentType; shareClass?: string;
  exchangeMic?: string; exchangeName?: string; exchange_region?: string; currency?: string;
  identifiers?: {scheme: string; value: string}[];
  status: 'ACTIVE' | 'SUSPENDED' | 'DELISTED' | 'UNKNOWN';
  listedAt?: string; delistedAt?: string;
  symbolHistory?: {symbol: string; validFrom?: string; validTo?: string}[];
  providerSymbols: Record<string, string>;
  sourceMetadata: {source: string; sourceUrl?: string; observedAt: string};
  underlyingInstrumentId?: string; depositaryCompanyId?: string; underlyingSharesPerReceipt?: string;
};
export const instrumentId = (legacyId: string) => `INS_${createHash('sha256').update(`youanalyst-instrument-v1:${legacyId}`).digest('hex').slice(0,32)}`;
export const validInstrumentId = (id: string) => /^INS_[a-f0-9]{32}$/.test(id);
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Explicit provider labels only. OTHER_EQUITY is never a fallback for unknown types. */
export function instrumentType(value: unknown): InstrumentType | undefined {
  if (INSTRUMENT_TYPES.includes(value as InstrumentType)) return value as InstrumentType;
  const types: Record<string, InstrumentType> = {
    'Common Stock': 'COMMON_SHARE', 'Common Share': 'COMMON_SHARE', 'Ordinary Share': 'COMMON_SHARE',
    'Preferred Stock': 'PREFERRED_SHARE', 'Preferred Share': 'PREFERRED_SHARE',
    'American Depositary Receipt': 'DEPOSITARY_RECEIPT', 'Depositary Receipt': 'DEPOSITARY_RECEIPT',
  };
  return typeof value === 'string' && Object.hasOwn(types,value) ? types[value] : undefined;
}

/** Stable legacy linkage is retained even after the ticker changes. No issuer guessing. */
export function instrumentFromCompany(id: string, data: Record<string, unknown>, companyId = id): Instrument | null {
  if (data.isDeleted === true || data.listingStatus === 'PRIVATE') return null;
  const listings = Array.isArray(data.listings) ? data.listings as Record<string, unknown>[] : [];
  const legacyListing=/^(US:[A-Z0-9.-]+|XSHG:\d{6}|XSHE:\d{6}|XBSE:\d{6})$/.test(id);
  // Global company records may already carry one verified listing. Multiple
  // listings require individual reviewed instruments, never choosing one silently.
  if(!legacyListing&&(!id.startsWith('ORG:')||data.listingStatus!=='PUBLIC'||listings.length!==1||!text(listings[0].symbol)||!text(listings[0].exchange)))return null;
  const symbol = legacyListing ? text(data.symbol) ?? id.slice(id.indexOf(':') + 1) : text(listings[0].symbol)!;
  const name=text(data.name);
  if (!name || !symbol) return null;
  const listing = listings.find(row => row.symbol === symbol);
  const exchangeMic = text(data.micCode) ?? text(listing?.exchange) ?? (/^X(SHG|SHE)|^XBSE/.test(id) ? id.split(':')[0] : undefined);
  const exchangeName = text(data.exchange) ?? exchangeMic;
  const type = instrumentType(data.instrumentType ?? data.type);
  // An issuer match does not establish share class, receipt ratio, or security equivalence.
  const value: Instrument = {companyId, name, symbol, status: data.active === true ? 'ACTIVE' : 'UNKNOWN',
    providerSymbols: {youanalyst: id}, sourceMetadata: {source: text(data.provider) ?? text(data.source) ?? 'legacy-company-directory',
      observedAt: text(data.lastSyncedAt) && Number.isFinite(Date.parse(String(data.lastSyncedAt))) ? String(data.lastSyncedAt) : '1970-01-01T00:00:00.000Z'}};
  if (type) value.instrumentType = type;
  if (exchangeMic && /^[A-Z0-9]{4}$/.test(exchangeMic)) value.exchangeMic = exchangeMic;
  if (exchangeName) value.exchangeName = exchangeName;
  if (text(data.exchange_region)) value.exchange_region = String(data.exchange_region);
  if (text(data.currency) && /^[A-Z]{3}$/.test(String(data.currency))) value.currency = String(data.currency);
  if (text(data.figiCode)) value.identifiers = [{scheme: 'FIGI', value: String(data.figiCode)}];
  if (text(data.provider)) value.providerSymbols[String(data.provider)] = symbol;
  if (text(data.source) && /^https:\/\//.test(String(data.source))) value.sourceMetadata.sourceUrl = String(data.source);
  return value;
}

export function validateInstrument(value: Instrument) {
  if (!value.companyId || value.companyId.includes('/') || !value.symbol || !value.name
    || (value.instrumentType !== undefined && !INSTRUMENT_TYPES.includes(value.instrumentType))
    || !['ACTIVE','SUSPENDED','DELISTED','UNKNOWN'].includes(value.status)
    || !value.sourceMetadata?.source || !Number.isFinite(Date.parse(value.sourceMetadata.observedAt))) throw Error('Invalid instrument');
  if (value.underlyingSharesPerReceipt !== undefined && (!/^\d+(\.\d+)?$/.test(value.underlyingSharesPerReceipt) || Number(value.underlyingSharesPerReceipt) <= 0)) throw Error('Invalid receipt ratio');
  return value;
}
