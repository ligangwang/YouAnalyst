import { expect, test } from "@playwright/test";

const internalToken = process.env.PLAYWRIGHT_INTERNAL_API_TOKEN;

function bearer(token: string) {
  return {
    authorization: `Bearer ${token}`,
  };
}

test("insider transaction sync rejects unauthenticated requests", async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/api/internal/securities/sync-insider-transactions`, {
    data: {
      date: "2026-05-08",
      dryRun: true,
      maxFilings: 1,
    },
  });

  expect(response.status()).toBe(401);
  const payload = await response.json();
  expect(payload.error).toBe("Unauthorized");
});

test("insider transaction sync dry run parses a small SEC sample", async ({ request, baseURL }) => {
  test.skip(!internalToken, "Set PLAYWRIGHT_INTERNAL_API_TOKEN to run the SEC Form 4 dry-run smoke test.");

  const response = await request.post(`${baseURL}/api/internal/securities/sync-insider-transactions`, {
    data: {
      date: "2026-05-08",
      dryRun: true,
      maxFilings: 3,
      transactionCodes: ["P", "S"],
    },
    headers: bearer(internalToken!),
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.dryRun).toBe(true);
  expect(payload.filingsFound).toBeGreaterThan(0);
  expect(payload.filingsFailed).toBe(0);
  expect(payload.transactionsParsed).toBeGreaterThan(0);
  expect(payload.transactionsWritten).toBe(0);
});
