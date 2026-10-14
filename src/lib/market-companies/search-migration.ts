import { companySearchFields, RETIRED_COMPANY_SEARCH_FIELDS } from './search';
// Explicitly approved alias; pinyin itself is generated for every company, never hardcoded.
const approvedAliases: Record<string, string[]> = { 'US:AMD': ['超微半导体'] };
export function companySearchMigration(id: string, data: Record<string, unknown>, cleanup = false) {
  const aliases = [...new Set([...(Array.isArray(data.aliases) ? data.aliases.filter((value): value is string => typeof value === 'string') : []), ...(approvedAliases[id] ?? [])])];
  const patch: Record<string, unknown> = { ...companySearchFields(id, { ...data, aliases }) };
  if (JSON.stringify(aliases) !== JSON.stringify(data.aliases ?? [])) patch.aliases = aliases;
  const removed = cleanup ? RETIRED_COMPANY_SEARCH_FIELDS.filter(field => Object.hasOwn(data, field)) : [];
  const changed = removed.length > 0 || Object.entries(patch).some(([field, value]) => JSON.stringify(data[field]) !== JSON.stringify(value));
  return { patch, removed, changed };
}
