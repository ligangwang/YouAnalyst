import {releaseProbeHeaders} from '../../scripts/release-probe.mjs';
import { test as base, expect } from '@playwright/test';
export { expect };
export type { Page } from '@playwright/test';
export const test = base.extend({
  context: async ({ context, baseURL }, runFixture) => {
    if (process.env.INTERNAL_API_TOKEN && baseURL) {
      await context.route(new URL(baseURL).origin + '/**', route => route.continue({headers:{...route.request().headers(),...releaseProbeHeaders(baseURL)}}));
    }
    await runFixture(context);
  },
  request: async ({ playwright, baseURL, extraHTTPHeaders }, runFixture) => {
    const request = await playwright.request.newContext({baseURL, extraHTTPHeaders:{...extraHTTPHeaders,...(baseURL?releaseProbeHeaders(baseURL):{})}});
    await runFixture(request);
    await request.dispose();
  },
});
