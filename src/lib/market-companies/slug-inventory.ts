// Server/proxy inventory. Do not import this module from client components.
import inventory from '../../../data/company-url-slugs.json';
import { companySlugPath } from './slugs';
export const COMPANY_SLUG_INVENTORY:Record<string,string> = inventory;
const ids=new Map(Object.entries(COMPANY_SLUG_INVENTORY).map(([id,slug])=>[slug,id]));
export function inventoryCompanyId(slug:string) { return ids.get(slug.toLowerCase()) ?? null; }
export function inventoryCompanyPath(id:string,slug?:unknown) { return companySlugPath(id,slug ?? COMPANY_SLUG_INVENTORY[id]); }
