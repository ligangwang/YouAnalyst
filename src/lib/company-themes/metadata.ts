import {catalogThemeName,resolveCatalogTheme,type ThemeCatalog} from './catalog-model';
import { parseCompanyTheme } from './model';

export function themeMetadata(raw: unknown,catalog:ThemeCatalog=[]) {
  const theme=resolveCatalogTheme(catalog,raw)??parseCompanyTheme(raw), name=catalogThemeName(catalog,theme);
  return {theme,title:'YouAnalyst | Investment Intelligence. Reimagined.',
    description:theme==='ai'?'Visual intelligence for investment research. Explore AI stocks, companies, and supply-chain relationships across US and China A-share markets.':`Explore ${name.toLowerCase()} companies, industry roles, documented supply-chain relationships and original company sources.`,
    canonical:theme==='ai'?'/':`/?theme=${theme}`};
}
