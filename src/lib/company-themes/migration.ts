import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import { GRAPH_SECTORS } from '../knowledge-graph/sectors';
import { activeThemeIds, ROBOTICS_SECTORS, SPACE_SECTORS, type ThemeMembership, type ThemedCompany } from './model';

export type RoboticsProposal = {
  id: string; expectedName: string; primarySector: string; secondaryRoles: string[];
  sources: { url: string; title: string; summary: string }[];
};
export type RoboticsBatch = { reviewedAt: string; companies: RoboticsProposal[] };
export type CompanyThemePatch = { id: string; expectedName: string; themeMemberships: Record<string, ThemeMembership>; themeIds: string[] };

export function validateThemeBatch(batch: RoboticsBatch, theme: 'robotics'|'space') {
  const sectors=theme==='space'?SPACE_SECTORS:ROBOTICS_SECTORS;
  assert(/^\d{4}-\d{2}-\d{2}$/.test(batch.reviewedAt) && Number.isFinite(Date.parse(batch.reviewedAt)) && new Date(batch.reviewedAt).toISOString().slice(0, 10) === batch.reviewedAt && batch.reviewedAt <= new Date().toISOString().slice(0, 10), 'Invalid review date');
  assert(batch.companies.length > 0 && batch.companies.length <= 100, 'Invalid company batch');
  assert(new Set(batch.companies.map(company => company.id)).size === batch.companies.length, 'Duplicate company IDs');
  for (const company of batch.companies) {
    assert(/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(company.id) && company.expectedName.trim(), 'Invalid canonical company identity');
    assert((sectors as readonly string[]).includes(company.primarySector), 'Unknown theme sector');
    assert(company.secondaryRoles.every(role => (sectors as readonly string[]).includes(role)), 'Unknown secondary role');
    assert(new Set(company.secondaryRoles).size === company.secondaryRoles.length && !company.secondaryRoles.includes(company.primarySector), 'Duplicate sector role');
    assert(company.sources.length > 0, 'Membership needs reviewed sources');
    for (const source of company.sources) {
      const url = new URL(source.url);
      assert(url.protocol === 'https:' && !url.username && !url.password && source.title.trim() && source.summary.trim(), 'Invalid membership source');
    }
  }
}
export const validateRoboticsBatch = (batch: RoboticsBatch) => validateThemeBatch(batch,'robotics');

/** Add a published theme without rewriting any pre-existing theme decision. */
export function planThemeEnrollment(records: ThemedCompany[], batch: RoboticsBatch, theme: 'robotics'|'space'): CompanyThemePatch[] {
  validateThemeBatch(batch,theme);
  const existing=new Map(records.map(record=>[record.id,record]));
  return batch.companies.flatMap(proposal=>{
    const record=existing.get(proposal.id);
    assert(record&&['DIRECTORY','PUBLISHED'].includes(String(record.status)),`${proposal.id}: missing reviewed public profile`);
    assert(record.name===proposal.expectedName,`${proposal.id}: canonical identity changed`);
    const memberships=structuredClone(record.themeMemberships??{});
    const membership:ThemeMembership={status:'PUBLISHED',primarySector:proposal.primarySector,secondaryRoles:proposal.secondaryRoles,reviewedAt:batch.reviewedAt,sources:proposal.sources};
    assert(!memberships[theme]||isDeepStrictEqual(memberships[theme],membership),`${proposal.id}: existing theme decision conflicts`);
    memberships[theme]=membership;
    const themeIds=activeThemeIds({themeMemberships:memberships});
    return isDeepStrictEqual(record.themeMemberships,memberships)&&isDeepStrictEqual(record.themeIds,themeIds)?[]:[{id:record.id,expectedName:proposal.expectedName,themeMemberships:memberships,themeIds}];
  });
}

/** Only return membership fields. No graph, identity, relationship or checkpoint writes. */
export function planCompanyThemeMigration(records: ThemedCompany[], ai: KnowledgeGraph, batch: RoboticsBatch): CompanyThemePatch[] {
  validateRoboticsBatch(batch);
  const companies = new Map(records.map(company => [company.id, company]));
  const desired = new Map<string, ThemeMembership>();
  for (const company of ai.nodes.filter(node => node.kind === 'COMPANY')) {
    const sector = GRAPH_SECTORS.find(sector => sector.stages.includes(company.stageIds?.[0] ?? ''))?.id ?? 'other';
    desired.set(company.id, { status: 'PUBLISHED', primarySector: sector, reviewedAt: batch.reviewedAt });
  }
  const proposals = new Map(batch.companies.map(company => [company.id, company]));
  const ids = new Set([...desired.keys(), ...proposals.keys()]);
  return [...ids].sort().flatMap(id => {
    const company = companies.get(id);
    assert(company && ['DIRECTORY', 'PUBLISHED'].includes(String(company.status)), `${id}: company missing or not public`);
    const proposal = proposals.get(id);
    if (proposal) assert(company.name === proposal.expectedName, `${id}: canonical identity changed`);
    const memberships = structuredClone(company.themeMemberships ?? {});
    if (desired.has(id)) {
      assert(!memberships.ai || memberships.ai.status === 'PUBLISHED', `${id}: AI editorial status conflicts with the existing map`);
      memberships.ai ??= desired.get(id)!;
    }
    if (proposal) {
      const next: ThemeMembership = { status: 'PUBLISHED', primarySector: proposal.primarySector,
        secondaryRoles: proposal.secondaryRoles, reviewedAt: batch.reviewedAt, sources: proposal.sources };
      assert(!memberships.robotics || isDeepStrictEqual(memberships.robotics, next), `${id}: Robotics editorial decision exists; review before replacing it`);
      memberships.robotics = next;
    }
    const themeIds = activeThemeIds({ themeMemberships: memberships });
    if (isDeepStrictEqual(company.themeMemberships, memberships) && isDeepStrictEqual(company.themeIds, themeIds)) return [];
    return [{ id, expectedName: String(company.name), themeMemberships: memberships, themeIds }];
  });
}
