import { parseCompanyTheme, themeName } from './model';

export function themeMetadata(raw: unknown) {
  const theme=parseCompanyTheme(raw), name=themeName(theme);
  return {theme,title:theme==='ai'?'AI Industry Map: AI Stocks & Companies | YouAnalyst':`${name} Industry Map: Companies & Supply Chains | YouAnalyst`,
    description:theme==='ai'?'Visual intelligence for investment research. Explore AI stocks, companies, and supply-chain relationships across US and China A-share markets.':`Explore ${name.toLowerCase()} companies, industry roles, documented supply-chain relationships and original company sources.`,
    canonical:theme==='ai'?'/':`/?theme=${theme}`};
}
