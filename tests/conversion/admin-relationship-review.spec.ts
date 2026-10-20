import { expect, test, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import type { ReviewCandidate, ReviewCompany, ReviewDecision } from '../../src/lib/relationship-review/model';

const origin = 'http://relationship-review.test';
let html: string;
const companies: ReviewCompany[] = [
  { id: 'US:AMD', name: 'AMD', legalName: 'Advanced Micro Devices, Inc.', themes: ['ai', 'robotics'] },
  { id: 'US:ANET', name: 'Arista', legalName: 'Arista Networks, Inc.', themes: ['ai', 'robotics'] },
];
const candidate: ReviewCandidate = {
  id: 'news:' + 'a'.repeat(64), version: 'b'.repeat(64), kind: 'NEWS_OBSERVATION', status: 'NEEDS_REVIEW',
  sourceName: 'AMD', targetName: 'Arista', sourceId: 'US:AMD', targetId: 'US:ANET',
  type: 'PARTNER_OF', state: 'ANNOUNCED', summary: 'AMD and Arista announced a robotics networking partnership.',
  createdAt: '2026-10-20T14:00:00Z', direction: 'source_to_target', category: false, decision: null,
  evidence: [{ url: 'https://investors.example.com/partnership', title: 'AMD and Arista announce networking partnership', quote: 'The two companies plan to develop networking for robotic systems.', sourceDate: '2026-10-19' }],
};
type Post = { action: string; input: Record<string, unknown>; previewToken?: string };
async function fixture(page: Page, options: { signedIn?: boolean; filing?: boolean; stale?: boolean; error?: boolean } = {}) {
  const c = structuredClone(candidate), posts: Post[] = [];
  if (options.filing) { c.id = 'filing:AMD_123_abc'; c.kind = 'FILING_OBSERVATION'; c.targetId = ''; }
  await page.addInitScript(signedIn => { window.authScenario = { signedIn }; }, options.signedIn ?? true);
  await page.route('**/*', async (route: Route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== origin) return route.abort();
    if (req.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
    expect(u.pathname).toBe('/api/admin/relationships');
    expect(req.headers().authorization).toBe('Bearer isolated-test-token');
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Post; posts.push(body);
      if (body.action === 'preview') return route.fulfill({ json: {
        token: 'c'.repeat(64), relationshipId: 'US:AMD__PARTNER_OF__US:ANET', source: companies[0], target: companies[1],
        type: 'PARTNER_OF', state: body.input.state, summary: body.input.summary, limitation: body.input.limitation,
        themeIds: body.input.themeIds, retainedThemes: [], existing: false, evidenceCount: 1, factCount: 1,
      } });
      if (options.stale) return route.fulfill({ status: 409, json: { error: 'Publication preview is stale; preview the current evidence and relationship again' } });
      const decision: ReviewDecision = { decision: body.action === 'reject' ? 'REJECTED' : 'APPROVED', reviewedBy: 'test-user', reviewedAt: '2026-10-20T15:00:00Z', note: String(body.input.note), auditId: 'test-audit', relationshipId: body.action === 'reject' ? null : 'US:AMD__PARTNER_OF__US:ANET', themeIds: body.action === 'reject' ? [] : ['robotics'] };
      c.status = decision.decision; c.decision = decision;
      return route.fulfill({ json: decision });
    }
    if (options.error) return route.fulfill({ status: 403, json: { error: 'Administrator access required' } });
    if (u.searchParams.has('companyId')) return route.fulfill({ json: companies.find(c => c.id === u.searchParams.get('companyId')) });
    if (u.searchParams.has('company')) return route.fulfill({ json: { items: [{ ...companies[1], exchange: 'NYSE', country: 'US' }] } });
    if (u.searchParams.has('id')) return route.fulfill({ json: { candidate: c, companies: options.filing ? [companies[0]] : companies, sourceText: 'Saved source: ' + c.evidence[0].quote, sourceWarning: options.filing ? 'Open the original filing to verify the quotation and its context.' : null } });
    return route.fulfill({ json: { items: u.searchParams.get('status') === c.status ? [c] : [], nextCursor: null } });
  });
  await page.goto(origin); return { posts, c };
}
async function openCandidate(page: Page) {
  await page.getByRole('button', { name: /AMD → Arista/ }).click();
  await expect(page.getByRole('heading', { name: 'Original evidence' })).toBeVisible();
}
async function prepare(page: Page) {
  await page.getByLabel('Scope and limitations').fill('Announcement only; deliveries remain unconfirmed.');
  await page.getByLabel('Review note / rejection reason').fill('Read the original source and checked identities.');
  await page.getByRole('checkbox', { name: 'Robotics', exact: true }).check();
  await page.getByRole('checkbox', { name: /I checked the source/ }).check();
}

test.beforeAll(async () => {
  const bundled = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdminRelationshipReview} from './src/components/admin-relationship-review'; createRoot(document.getElementById('root')).render(<AdminRelationshipReview/>);`, loader: 'tsx', resolveDir: process.cwd() },
    outfile: 'fixture.js', bundle: true, write: false, platform: 'browser', define: { 'process.env': '{}' },
    alias: { 'next/link': path.resolve('tests/industry/link.tsx'), '@/components/providers/auth-provider': path.resolve('tests/conversion/fixtures/mocks.tsx') },
  });
  const js = bundled.outputFiles.find(f => f.path.endsWith('.js'))!.text, css = bundled.outputFiles.find(f => f.path.endsWith('.css'))!.text;
  html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#071b2b;font-family:Arial,sans-serif}${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
});

test('review evidence, require explicit themes, preview, then publish and inspect history', async ({ page }, info) => {
  const f = await fixture(page); await openCandidate(page);
  await expect(page.getByRole('link', { name: candidate.evidence[0].title + ' ↗' })).toHaveAttribute('href', candidate.evidence[0].url);
  await page.getByText('Read saved article text', { exact: true }).click();
  await expect(page.getByText('Saved source:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview publication' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /Space/ })).toBeDisabled();
  await prepare(page); await page.getByRole('button', { name: 'Preview publication' }).click();
  await expect(page.getByRole('region', { name: 'Publication preview' })).toContainText('Robotics');
  expect(f.posts.map(p => p.action)).toEqual(['preview']);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(e => e.clientWidth));
  await page.screenshot({ path: info.outputPath('review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Relationship published' })).toBeVisible();
  expect(f.posts.map(p => p.action)).toEqual(['preview', 'approve']);
  expect(f.posts[1].input.themeIds).toEqual(['robotics']); expect(f.posts[1].previewToken).toBe('c'.repeat(64));
  await page.getByRole('button', { name: 'Published', exact: true }).click(); await openCandidate(page);
  await expect(page.getByRole('heading', { name: 'Approved and published' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0);
});

test('reject requires a reason and confirmation and keeps evidence in history', async ({ page }) => {
  const f = await fixture(page); await openCandidate(page);
  await page.getByRole('button', { name: 'Reject candidate' }).click();
  await expect(page.getByRole('button', { name: 'Confirm rejection' })).toBeDisabled();
  expect(f.posts).toEqual([]);
  await page.getByLabel('Review note / rejection reason').fill('No evidence of this relationship.');
  await page.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Candidate rejected' })).toBeVisible();
  expect(f.posts.map(p => p.action)).toEqual(['reject']);
  await page.getByRole('button', { name: 'Rejected', exact: true }).click(); await openCandidate(page);
  await expect(page.getByText('No evidence of this relationship.', { exact: true })).toBeVisible();
});

test('unresolved filing company must be selected before publication', async ({ page }) => {
  const f = await fixture(page, { filing: true }); await openCandidate(page);
  const target = page.getByRole('region', { name: 'To company', exact: true });
  await expect(target).toContainText('Select a verified company identity.');
  await page.getByLabel('To company name or ticker').fill('ANET');
  await target.getByRole('button', { name: 'Search', exact: true }).click();
  await target.getByRole('button', { name: /Arista Networks, Inc./ }).click();
  await expect(target).toContainText('US:ANET');
  await prepare(page); await page.getByRole('button', { name: 'Preview publication' }).click();
  await expect(page.getByRole('region', { name: 'Publication preview' })).toBeVisible();
  expect(f.posts[0].input.targetId).toBe('US:ANET');
});

test('edits invalidate previews and stale publication shows an error without reporting success', async ({ page }) => {
  const f = await fixture(page, { stale: true }); await openCandidate(page); await prepare(page);
  await page.getByRole('button', { name: 'Preview publication' }).click();
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeVisible();
  await page.getByLabel('Supported claim').fill('Revised supported claim.');
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview publication' }).click();
  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByRole('alert')).toContainText('Publication preview is stale');
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0);
  expect(f.c.status).toBe('NEEDS_REVIEW');
});

test('unauthenticated and non-admin viewers see no evidence', async ({ page }) => {
  await fixture(page, { signedIn: false });
  await expect(page.getByText('Sign in with an administrator account to review relationships.')).toBeVisible();
  await expect(page.getByRole('button', { name: /AMD → Arista/ })).toHaveCount(0);
});
test('admin denial is visible and does not render candidates', async ({ page }) => {
  await fixture(page, { error: true });
  await expect(page.getByRole('alert')).toHaveText('Administrator access required');
  await expect(page.getByRole('button', { name: /AMD → Arista/ })).toHaveCount(0);
});

