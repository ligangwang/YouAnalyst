import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { componentFixtureHtml } from './fixtures/component-html';

let memberHtml: string, adminHtml: string;
const id = 'US:AMD__PARTNER_OF__US:ANET', version = 'a'.repeat(64);
const relationship = { sourceId: 'US:AMD', targetId: 'US:ANET', type: 'PARTNER_OF', state: 'DOCUMENTED', summary: 'AMD and Arista collaborate on AI networking.', limitation: '', themeIds: ['ai'] };
test.beforeAll(async () => {
  const options = { jsx: 'automatic' as const, plugins: [{ name: 'isolated-auth', setup(build: import('esbuild').PluginBuild) { build.onResolve({ filter: /auth-provider$/ }, () => ({ path: path.resolve('tests/conversion/fixtures/mocks.tsx') })); } }], alias: { 'next/link': path.resolve('tests/conversion/fixtures/mocks.tsx'), 'next/navigation': path.resolve('tests/conversion/fixtures/mocks.tsx') } };
  const css = 'body{margin:0;padding:16px;background:#07101c;color:#eaf2fd;font:16px Arial}main{max-width:900px;margin:auto}input,textarea,select{max-width:100%;box-sizing:border-box;padding:8px}textarea{min-height:80px}fieldset,section,aside{min-width:0}form>label{display:block;margin:16px 0}form>label input:not([type=checkbox]),textarea,select{display:block;width:100%}button{min-height:44px;padding:8px;margin:4px}a{color:cyan}p{overflow-wrap:anywhere}';
  memberHtml = await componentFixtureHtml(`import React from 'react';import{createRoot}from'react-dom/client';import{RelationshipCommunityPage}from'./src/components/relationship-community-page';createRoot(document.getElementById('root')).render(<RelationshipCommunityPage/>);`, options, css);
  adminHtml = await componentFixtureHtml(`import React from 'react';import{createRoot}from'react-dom/client';import{AdminRelationshipQueues}from'./src/components/admin-relationship-contributions';createRoot(document.getElementById('root')).render(<AdminRelationshipQueues/>);`, options, css);
});
async function member(page: Page, signedIn = true, stale = false) {
  await page.addInitScript(value => { window.authScenario = { signedIn: value }; }, signedIn);
  const posts: Record<string, unknown>[] = []; let open = 0;
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/relationships/contributions') {
      if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); if (stale) return route.fulfill({ status: 409, json: { error: 'Relationship changed. Reload its evidence before submitting.' } }); open = 1; return route.fulfill({ json: { id: 'report', status: 'OPEN' } }); }
      return route.fulfill({ json: u.searchParams.has('mine') ? { points: 10, usefulContributions: 1, items: [] } : { relationshipId: id, version, origin: 'AI', openDisputes: open, credits: [], relationship } });
    }
    return route.fulfill({ contentType: 'text/html', body: memberHtml });
  });
  await page.goto('http://community.test/relationships/review?relationshipId=' + encodeURIComponent(id)); return posts;
}
async function evidence(page: Page) {
  await page.getByLabel('What is wrong, and why?', { exact: true }).fill('The source has the supplier and customer in the opposite direction.');
  await page.getByLabel('Evidence URL', { exact: true }).fill('https://investors.example.com/relationship');
  await page.getByLabel('Supporting quotation', { exact: true }).fill('Arista supplies networking technology to AMD for AI infrastructure.');
}
test('visitors see provisional provenance and sign-in, members submit evidence-backed disputes', async ({ page }) => {
  const posts = await member(page, false);
  await expect(page.getByText('AI-extracted · Not community verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to dispute or correct a relationship' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-auth-user', { detail: 'test-user' })));
  await evidence(page); await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('status')).toContainText('Contribution submitted');
  await expect(page.getByText(/Disputed \(1\)/)).toBeVisible();
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ relationshipId: id, version, kind: 'DISPUTE', publicCredit: false });
});
test('correction swaps direction, preserves announced status and asks separately for public credit', async ({ page }) => {
  const posts = await member(page);
  await page.getByRole('combobox', { name: 'Contribution', exact: true }).selectOption('CORRECTION');
  await evidence(page); await page.getByRole('button', { name: /^Swap direction/ }).click();
  await page.getByRole('combobox', { name: 'Relationship', exact: true }).selectOption('SUPPLIER_OF');
  await page.getByRole('combobox', { name: 'Evidence state', exact: true }).selectOption('ANNOUNCED');
  await page.getByRole('textbox', { name: 'Corrected claim', exact: true }).fill('Arista plans to supply networking technology to AMD.');
  await page.getByRole('textbox', { name: 'Scope and limitations', exact: true }).fill('Announced plans only; no completed delivery is confirmed.');
  await page.getByRole('checkbox', { name: 'Show my member name on accepted corrections' }).check();
  await page.getByRole('button', { name: 'Submit for review' }).click(); await expect(page.getByRole('status')).toContainText('submitted');
  expect(posts[0]).toMatchObject({ kind: 'CORRECTION', publicCredit: true, correction: { sourceId: 'US:ANET', targetId: 'US:AMD', type: 'SUPPLIER_OF', state: 'ANNOUNCED', themeIds: ['ai'] } });
  await expect(page.getByText('10 credit points · 1 accepted contributions')).toBeVisible();
});
test('stale submission displays actionable error and retains the evidence form', async ({ page }) => {
  await member(page, true, true); await evidence(page); await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('alert')).toContainText('Relationship changed'); await expect(page.getByLabel('Supporting quotation')).toHaveValue(/Arista supplies/);
});
test('admin starts in dispute queue and awards credit only after explicit independent source review', async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const posts: Record<string, unknown>[] = []; let saved = false;
  await page.route('**/*', route => {
    if (new URL(route.request().url()).pathname === '/api/admin/relationship-contributions') {
      if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); saved = true; return route.fulfill({ json: { status: 'ACCEPTED', creditedPoints: 10 } }); }
      return route.fulfill({ json: { items: saved ? [] : [{ id: 'b'.repeat(64), reviewVersion: version, relationshipId: id, kind: 'DISPUTE', status: 'OPEN', userId: 'member', creditName: 'Mira', reason: 'This source contradicts the relationship claim.', evidenceUrl: 'https://investors.example.com/evidence', evidenceQuote: 'These companies explicitly do not compete in this market.', relationshipSnapshot: { source: 'US:AMD', target: 'US:ANET', type: 'PARTNER_OF', summary: relationship.summary } }], nextCursor: null } });
    }
    return route.fulfill({ contentType: 'text/html', body: adminHtml });
  });
  await page.goto('http://community.test/admin/relationships');
  await expect(page.getByRole('button', { name: 'Community disputes & corrections', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('complementary', { name: 'Community review queue' }).getByRole('button').first().click();
  const accept = page.getByRole('button', { name: 'Accept dispute & withdraw relationship' }); await expect(accept).toBeDisabled();
  await page.getByLabel('Review decision and reasoning', { exact: true }).fill('Checked the original source; the dispute is correct.');
  await page.getByRole('checkbox', { name: /I checked the original source/ }).check(); await accept.click();
  await expect(page.getByRole('status').filter({hasText:'Review saved.'})).toContainText('Contribution credit: 10');
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ outcome: 'ACCEPTED', evidenceConfirmed: true });
});
