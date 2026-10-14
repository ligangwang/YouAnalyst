import { expect, test } from '@playwright/test';
import path from 'node:path';
import { componentFixtureHtml } from './fixtures/component-html';

for (const chinese of [false, true]) test(`retired research shows ${chinese ? 'Chinese' : 'English'} notice without launch controls or API requests`, async ({ page }) => {
  const html = await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {RetiredCompanyResearch} from './src/components/retired-company-research';createRoot(document.getElementById('root')).render(<RetiredCompanyResearch/>);`, {
    jsx: 'automatic', alias: { 'next/link': path.resolve('tests/conversion/fixtures/mocks.tsx') },
    plugins: [{ name: 'retired-locale', setup(build) {
      build.onResolve({ filter: /locale-provider$/ }, () => ({ path: 'locale', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export function useLocale(){return {text:(en,zh)=>${chinese}?zh:en}}` }));
    } }],
  });
  const calls: string[] = [];
  await page.route('**/*', route => {
    if (route.request().url().includes('/api/')) calls.push(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://fixture.test/admin/industry-research');
  await expect(page.getByRole('heading')).toHaveText(chinese ? 'AI 公司与行业研究已停用' : 'AI company and industry research retired');
  await expect(page.getByRole('link')).toHaveAttribute('href', '/admin/jobs');
  await expect(page.getByRole('button')).toHaveCount(0);
  expect(calls).toEqual([]);
});
