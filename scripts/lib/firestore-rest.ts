import type { ThemedCompany } from '../../src/lib/company-themes/model';

export type Value = { mapValue?: { fields?: Record<string, Value> }; arrayValue?: { values?: Value[] }; stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean; nullValue?: null; timestampValue?: string };
export type Document = { name: string; fields: Record<string, Value>; updateTime: string };
export type Request = (url: string, method?: 'GET' | 'POST', data?: unknown) => Promise<unknown>;
export const decode = (value: Value): unknown => value.mapValue ? Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]))
  : value.arrayValue ? (value.arrayValue.values ?? []).map(decode)
  : value.integerValue !== undefined ? Number(value.integerValue) : Object.values(value)[0];
export const encode = (value: unknown): Value => value === null ? { nullValue: null }
  : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } }
  : typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(value as object).map(([key, item]) => [key, encode(item)])) } }
  : typeof value === 'number' ? Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  : typeof value === 'boolean' ? { booleanValue: value } : { stringValue: String(value) };
export const company = (document: Document): ThemedCompany => ({ ...Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, decode(value)])), id: document.name.split('/').at(-1)! });

