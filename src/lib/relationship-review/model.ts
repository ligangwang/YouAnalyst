import type { CompanyThemeId } from '../company-themes/model';

export const REVIEW_TYPES = [
  'SUPPLIER_OF', 'CUSTOMER_OF', 'PARTNER_OF', 'COMPETES_WITH',
  'DISTRIBUTES_FOR', 'MANUFACTURES_FOR', 'INTEGRATES_TECHNOLOGY_FROM',
  'PLANNED_ADOPTER_OF', 'ECOSYSTEM_PARTNER_OF', 'ACQUIRES',
] as const;
export type ReviewType = typeof REVIEW_TYPES[number];
export type ReviewState = 'DOCUMENTED' | 'ANNOUNCED' | 'TERMINATED';
export type ReviewStatus = 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
export type ReviewCompany = { id: string; name: string; legalName: string; themes: CompanyThemeId[] };
export type ReviewEvidence = { url: string; title: string; quote: string; sourceDate: string | null };
export type ReviewDecision = {
  decision: 'APPROVED' | 'REJECTED'; reviewedBy: string; reviewedAt: string;
  note: string; auditId: string; relationshipId: string | null; themeIds: CompanyThemeId[];
};
export type ReviewCandidate = {
  automaticValidation?: { reasons: string[]; checkedAt: string };
  id: string; version: string; kind: 'NEWS_OBSERVATION' | 'FILING_OBSERVATION';
  status: ReviewStatus; sourceName: string; targetName: string; sourceId: string; targetId: string;
  type: string; state: ReviewState; summary: string; createdAt: string;
  evidence: ReviewEvidence[]; direction: string; category: boolean; eventDate: string | null;
  decision: ReviewDecision | null;
};
export type ReviewDetail = {
  candidate: ReviewCandidate; companies: ReviewCompany[];
  sourceText: string | null; sourceWarning: string | null;
};
export type PublicationInput = {
  candidateId: string; version: string; sourceId: string; targetId: string;
  type: ReviewType; state: ReviewState; themeIds: CompanyThemeId[];
  summary: string; limitation: string; note: string; evidenceConfirmed: true; eventDate?: string | null;
};
export type ReviewPreview = {
  token: string; relationshipId: string; source: ReviewCompany; target: ReviewCompany;
  type: string; state: ReviewState; summary: string; limitation: string;
  themeIds: CompanyThemeId[]; retainedThemes: CompanyThemeId[]; existing: boolean;
  evidenceCount: number; factCount: number; eventDate: string | null;
};
export const reviewVerbs: Record<ReviewType, [string, string]> = {
  SUPPLIER_OF: ['supplies', '供应给'], CUSTOMER_OF: ['buys from', '采购自'],
  PARTNER_OF: ['partners with', '合作于'], COMPETES_WITH: ['competes with', '竞争于'],
  DISTRIBUTES_FOR: ['distributes for', '分销其产品'], MANUFACTURES_FOR: ['manufactures for', '为其制造'],
  INTEGRATES_TECHNOLOGY_FROM: ['integrates technology from', '集成其技术'],
  PLANNED_ADOPTER_OF: ['plans to adopt technology from', '计划采用其技术'],
  ECOSYSTEM_PARTNER_OF: ['is an ecosystem partner of', '为其生态合作伙伴'],
  ACQUIRES: ['acquires', '收购'],
};
