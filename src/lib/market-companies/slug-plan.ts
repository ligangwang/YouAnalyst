import { ORGANIZATION_COMPANY_SLUGS, PUBLIC_COMPANY_SLUGS } from './slugs';

export type SlugCompany = { id:string; name?:unknown; names?:unknown; en?:unknown; slug?:unknown; slugAliases?:unknown };
export type CompanySlugPlan = { id:string; name:string; slug:string; slugAliases:string[]; previousSlug:string|null; previousAliases:string[] };
export function validCompanySlug(value:unknown):value is string {
  return typeof value === 'string' && value.length <= 120 && /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(value) && value === value.toLowerCase() && !value.startsWith('ticker-');
}
export function nameSlug(name:string):string {
  return name.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/\b(incorporated|corporation|limited|inc|corp|ltd|plc)\.?\s*$/iu,'').replace(/&/g,' and ')
    .replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,100).replace(/-$/,'');
}
export function buildCompanySlugPlan(companies:SlugCompany[]):CompanySlugPlan[] {
  const used = new Map<string,string>(), rows:CompanySlugPlan[] = [];
  const curated = (id:string) => id === 'US:MU' ? 'micron' : id.startsWith('US:') ? PUBLIC_COMPANY_SLUGS[id.slice(3)] : ORGANIZATION_COMPANY_SLUGS[id];
  const ordered = [...companies].sort((a,b)=> Number(Boolean(validCompanySlug(b.slug)||curated(b.id))) - Number(Boolean(validCompanySlug(a.slug)||curated(a.id))) || a.id.localeCompare(b.id));
  for (const c of ordered) {
    if (typeof c.name !== 'string' || !c.name.trim()) throw new Error(`Missing company name: ${c.id}`);
    const names = c.names && typeof c.names === 'object' ? c.names as Record<string,unknown> : {};
    const english = typeof names.en === 'string' && names.en.trim() ? names.en : typeof c.en === 'string' && c.en.trim() ? c.en : c.name;
    const pinned = validCompanySlug(c.slug) ? c.slug : curated(c.id);
    let slug = pinned ?? nameSlug(english);
    if (!validCompanySlug(slug)) throw new Error(`Cannot generate company slug: ${c.id}`);
    if (used.has(slug)) {
      if (pinned) throw new Error(`Existing slug collision: ${slug}`);
      slug = `${slug}-${nameSlug(c.id.replace(':','-'))}`;
    }
    if (!validCompanySlug(slug) || used.has(slug)) throw new Error(`Company slug collision: ${c.id}`);
    used.set(slug,c.id);
    const oldAliases = Array.isArray(c.slugAliases) ? c.slugAliases.filter((a):a is string=>typeof a === 'string') : [];
    rows.push({id:c.id,name:c.name,slug,previousSlug:typeof c.slug === 'string'?c.slug:null,previousAliases:oldAliases,
      slugAliases:[...new Set([...oldAliases,...(typeof c.slug === 'string' && c.slug !== slug ? [c.slug] : [])])].filter(a=>a!==slug)});
  }
  for (const row of rows) for (const alias of row.slugAliases) {
    if (!validCompanySlug(alias) || used.has(alias) && used.get(alias)!==row.id) throw new Error(`Conflicting slug alias: ${row.id}`);
    used.set(alias,row.id);
  }
  return rows.sort((a,b)=>a.id.localeCompare(b.id));
}
