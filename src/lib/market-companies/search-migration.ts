import { companySearchFields, RETIRED_COMPANY_SEARCH_FIELDS } from './search';
// Explicitly approved alias; pinyin itself is generated for every company, never hardcoded.
const approvedAliases: Record<string, string[]> = { 'US:AMD': ['超微半导体'] };
export function companySearchMigration(id: string, data: Record<string, unknown>, cleanup = false) {
  const aliases = [...new Set([...(Array.isArray(data.aliases) ? data.aliases.filter((value): value is string => typeof value === 'string') : []), ...(approvedAliases[id] ?? [])])];
  const computed: Record<string, unknown> = { ...companySearchFields(id, { ...data, aliases }) };
  if (approvedAliases[id]?.length && JSON.stringify(aliases) !== JSON.stringify(data.aliases ?? [])) computed.aliases = aliases;
  const removed = cleanup ? RETIRED_COMPANY_SEARCH_FIELDS.filter(field => Object.hasOwn(data, field)) : [];
  const patch = Object.fromEntries(Object.entries(computed).filter(([field,value])=>JSON.stringify(data[field])!==JSON.stringify(value)));
  const changed = removed.length > 0 || Object.keys(patch).length > 0;
  return { patch, removed, changed };
}
