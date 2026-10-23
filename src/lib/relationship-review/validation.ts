import type { CompanyThemeId } from '../company-themes/model';
import type { ReviewType } from './model';

export const AUTO_POLICY_VERSION = 2;
export type ClaimCompany = { id: string; names: string[]; themes: CompanyThemeId[] };
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mention(text: string, names: string[]) {
  return names.filter(n => n.trim().length >= 3).map(normalize).find(n => new RegExp(`(?<![a-z0-9])${escape(n)}(?![a-z0-9])`, 'u').test(text));
}
/** A deliberately conservative gate. Model confidence alone never establishes a claim. */
export function validateAutomaticClaim(input: { source: ClaimCompany; target: ClaimCompany; type: ReviewType; state: string; quote: string; confidence: number; category: boolean; date: string; eventDate?: string | null; themeTerms?:Record<string,string[]> }) {
  const errors: string[] = [], q = normalize(input.quote);
  if (input.category) errors.push('Unnamed category');
  if (input.source.id === input.target.id) errors.push('Identical companies');
  if (!Number.isFinite(input.confidence) || input.confidence < .9 || input.confidence > 1) errors.push('Confidence must be between 0.90 and 1.00');
  if (!['DOCUMENTED', 'ANNOUNCED', 'TERMINATED'].includes(input.state)) errors.push('Unsupported evidence state');
  if (input.state === 'TERMINATED') errors.push('Termination requires review');
  if (input.type === 'PLANNED_ADOPTER_OF' && input.state !== 'ANNOUNCED') errors.push('Adoption must remain planned');
  if (input.eventDate && input.eventDate > input.date && input.state !== 'ANNOUNCED') errors.push('Future event is not announced');
  if (/\b(?:will|plans? to|intends? to|expects? to)\b/.test(q) && input.state !== 'ANNOUNCED') errors.push('Future commitment must remain announced');
  if (/\b(no longer|formerly|previously|not\b|never|doesn.t|didn.t|without|may|might|could|potential|encouraged)\b/.test(q)) errors.push('Negation, historical or uncertain context');
  const s = mention(q, input.source.names), t = mention(q, input.target.names);
  if (!s || !t || s === t) errors.push('Quote must explicitly name both verified companies');
  const verbs: Record<ReviewType, string> = {
    PARTNER_OF: '(?:partner|collaborat|alliance|joint)', ECOSYSTEM_PARTNER_OF: '(?:partner|collaborat|alliance|joint)',
    COMPETES_WITH: '(?:competitor|compete)', SUPPLIER_OF: '(?:suppl(?:y|ies)|provides?|sell(?:s)?|sold|deliver(?:s)?)',
    CUSTOMER_OF: '(?:buy|buys|purchas(?:e|es)|licens(?:e|es)|customer of)',
    MANUFACTURES_FOR: '(?:manufactur(?:e|es)|produc(?:e|es)|assembl(?:e|es))', DISTRIBUTES_FOR: '(?:distribut(?:e|es)|resell(?:s)?|reseller)',
    INTEGRATES_TECHNOLOGY_FROM: '(?:integrat(?:e|es)|us(?:e|es)|deploy(?:s)?|powered by|built on)',
    PLANNED_ADOPTER_OF: '(?:plans? to|will|intend(?:s)? to).{0,60}(?:adopt|deploy|use|integrate)',
    ACQUIRES: '(?:acquir(?:e|es|ed)|will acquire)',
  };
  if (!new RegExp(verbs[input.type]).test(q)) errors.push('No explicit relationship language');
  // Symmetric relationships do not have a supplier/customer direction.
  if (s && t && !['PARTNER_OF', 'COMPETES_WITH', 'ECOSYSTEM_PARTNER_OF'].includes(input.type)
    && !new RegExp(`${escape(s)}.{0,160}${verbs[input.type]}.{0,160}${escape(t)}`).test(q)) errors.push('Direction is not explicit');
  // Name order alone reverses passive claims, including reduced constructions
  // such as "AMD, acquired by Arista". Hold these for review rather than flip
  // an extracted edge. "Powered by" and "built on" correctly identify a user
  // of the target's technology, so are not reverse integration constructions.
  const passive: Partial<Record<ReviewType, string>> = {
    SUPPLIER_OF: '(?:supplied|provided|sold|delivered)', CUSTOMER_OF: '(?:bought|purchased|licensed)',
    MANUFACTURES_FOR: '(?:manufactured|produced|assembled)', DISTRIBUTES_FOR: '(?:distributed|resold)',
    INTEGRATES_TECHNOLOGY_FROM: '(?:integrated|used|deployed)', PLANNED_ADOPTER_OF: '(?:adopted|deployed|used|integrated)',
    ACQUIRES: 'acquired',
  };
  if (s && t && passive[input.type] && new RegExp(`${escape(s)}.{0,160}\\b${passive[input.type]}\\b.{0,160}\\bby\\b.{0,160}${escape(t)}`).test(q)) errors.push('Passive relationship direction requires review');
  if (input.type === 'ACQUIRES' && /\b(portfolio|assets?|division|business|stake|interest|from)\b/.test(q)) errors.push('Acquisition target may be assets rather than the company');
  const thematic: Record<CompanyThemeId, RegExp> = { ai: /\b(ai|artificial intelligence|gpu|cpu|semiconductor|memory|chip|cloud|data.?center|inference|comput(?:e|ing)|silicon|ethernet|cxl)\b/, robotics: /\b(robot\w*|autonomous|automation|motion|sensor\w*|machine vision|physical ai)\b/, space: /\b(space\w*|satellite\w*|orbit\w*|rocket\w*|launch\w*|lunar|spacecraft)\b/ };
  const themes = input.source.themes.filter(theme => input.target.themes.includes(theme) && Boolean(thematic[theme]?.test(q) || input.themeTerms?.[theme]?.some(term=>term.length>=3 && q.includes(normalize(term)))));
  if (!themes.length) errors.push('No supported shared theme');
  return { eligible: errors.length === 0, errors, themeIds: themes };
}
