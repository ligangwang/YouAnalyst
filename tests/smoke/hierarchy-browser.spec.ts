import { test, expect } from '@playwright/test';

test('industry links locate a code, search navigates, and back restores selection', async ({ page }) => {
  await page.goto('/en/industries?taxonomy=SIC&code=3674');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Semiconductors & Related Devices');
  await page.getByLabel('Find a category').fill('7372');
  await page.locator('aside').getByRole('link', { name: /Prepackaged Software/ }).click();
  await expect(page).toHaveURL(/code=7372/);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Services-Prepackaged Software');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Semiconductors & Related Devices');
  await page.goto('/en/industries?taxonomy=SIC&code=invalid');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Category not found');
});

test('theme deep links and Chinese mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh-cn/investment-themes?node=ai.chips');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('芯片');
  await expect(page.getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '人工智能', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '人工智能', exact: true }).click();
  await expect(page).toHaveURL(/node=ai$/);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('人工智能');
});
