import { expect, test } from "@playwright/test";

const adminToken = process.env.PLAYWRIGHT_ADMIN_AUTH_BEARER_TOKEN;
const userToken = process.env.PLAYWRIGHT_USER_AUTH_BEARER_TOKEN;
const digestUserId = process.env.PLAYWRIGHT_INSTITUTION_DIGEST_USER_ID;
const institutionCik = process.env.PLAYWRIGHT_INSTITUTION_CIK;

function bearer(token: string) {
  return {
    authorization: `Bearer ${token}`,
  };
}

test("admin institution digest dry run does not persist run records", async ({ request, baseURL }) => {
  test.skip(!adminToken || !digestUserId, "Set PLAYWRIGHT_ADMIN_AUTH_BEARER_TOKEN and PLAYWRIGHT_INSTITUTION_DIGEST_USER_ID.");

  const response = await request.post(`${baseURL}/api/admin/institutions/digests`, {
    data: {
      action: "run",
      dryRun: true,
      limitItems: 10,
      limitUsers: 1,
      userIds: [digestUserId],
    },
    headers: bearer(adminToken!),
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.dryRun).toBe(true);
  expect(Array.isArray(payload.users)).toBe(true);

  for (const user of payload.users) {
    expect(user.runId).toBeNull();
    expect(user.updatedCheckpoint).toBe(false);
  }
});

test("user institution digest history endpoint returns best-effort unread count", async ({ request, baseURL }) => {
  test.skip(!userToken, "Set PLAYWRIGHT_USER_AUTH_BEARER_TOKEN.");

  const response = await request.get(`${baseURL}/api/institutions/follows/digest/runs?limit=8`, {
    headers: bearer(userToken!),
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(Array.isArray(payload.items)).toBe(true);
  expect(typeof payload.unreadCount).toBe("number");
  expect(payload.unreadCount).toBeGreaterThanOrEqual(0);
});

test("institution follow API supports reversible follow management", async ({ request, baseURL }) => {
  test.skip(!userToken || !institutionCik, "Set PLAYWRIGHT_USER_AUTH_BEARER_TOKEN and PLAYWRIGHT_INSTITUTION_CIK.");

  const followResponse = await request.post(`${baseURL}/api/institutions/${encodeURIComponent(institutionCik!)}/follow`, {
    headers: bearer(userToken!),
  });
  expect(followResponse.ok()).toBeTruthy();
  const followPayload = await followResponse.json();
  expect(followPayload.isFollowing).toBe(true);

  const listResponse = await request.get(`${baseURL}/api/institutions/follows?limit=50`, {
    headers: bearer(userToken!),
  });
  expect(listResponse.ok()).toBeTruthy();
  const listPayload = await listResponse.json();
  expect(listPayload.items.some((item: { cik: string }) => item.cik === followPayload.institution.cik)).toBe(true);

  const unfollowResponse = await request.delete(`${baseURL}/api/institutions/${encodeURIComponent(institutionCik!)}/follow`, {
    headers: bearer(userToken!),
  });
  expect(unfollowResponse.ok()).toBeTruthy();
  const unfollowPayload = await unfollowResponse.json();
  expect(unfollowPayload.isFollowing).toBe(false);
});
