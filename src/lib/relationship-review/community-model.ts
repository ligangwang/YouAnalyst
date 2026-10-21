import type { ReviewState, ReviewType } from './model';
import type { CompanyThemeId } from '../company-themes/model';

export type RelationshipCorrection = { sourceId: string; targetId: string; type: ReviewType; state: ReviewState; summary: string; limitation: string; themeIds: CompanyThemeId[] };
export type ContributionInput = { relationshipId: string; version: string; kind: 'DISPUTE' | 'CORRECTION'; reason: string; evidenceUrl: string; evidenceQuote: string; publicCredit: boolean; correction?: RelationshipCorrection };
export type RelationshipContribution = ContributionInput & { id: string; userId: string; creditName: string; status: 'OPEN' | 'ACCEPTED' | 'DISMISSED'; createdAt: string; reviewedAt?: string; reviewedBy?: string; resolution?: string; creditedPoints?: number; relationshipSnapshot: Record<string, unknown>; version: string };
