import assert from "node:assert/strict";
import { test } from "node:test";
import { emailActionResponse } from "../../src/lib/firebase/email-action";

test("Firebase actions retain codes and locale while pinning project and continuation", () => {
  for (const mode of ["resetPassword", "verifyEmail", "recoverEmail", "verifyAndChangeEmail", "revertSecondFactorAddition"]) {
    const params = new URLSearchParams({ mode, oobCode: "fake-code+/=", lang: "zh-CN", apiKey: "untrusted", tenantId: "test-tenant", continueUrl: "https://youanalyst.com/en/watchlists/following?company=US%3AAMD" });
    const response = emailActionResponse(new Request(`https://youanalyst.com/__/auth/action?${params}`), "ifindata-80905", "configured-key");
    const target = new URL(response.headers.get("location")!);
    assert.equal(response.status, 307);
    assert.equal(target.origin, "https://ifindata-80905.firebaseapp.com");
    for (const key of ["mode", "oobCode", "lang", "tenantId", "continueUrl"]) assert.equal(target.searchParams.get(key), params.get(key));
    assert.equal(target.searchParams.get("apiKey"), "configured-key");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
});

test("missing codes show bilingual guidance without reflecting input", async () => {
  const response = emailActionResponse(new Request("https://youanalyst.com/__/auth/action?mode=%3Cscript%3E"));
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /完整链接/);
  assert.doesNotMatch(html, /<script>/);
});

test("untrusted continuation and invalid project cannot redirect users off project", () => {
  for (const continueUrl of ["https://evil.example", "javascript:alert(1)", "https://youanalyst.com@evil.example", "https://youanalyst.com:444/", "not a URL"]) {
    const request = new Request(`https://youanalyst.com/__/auth/action?mode=verifyEmail&oobCode=fake&continueUrl=${encodeURIComponent(continueUrl)}`);
    assert.equal(new URL(emailActionResponse(request, "ifindata-80905", "key").headers.get("location")!).searchParams.has("continueUrl"), false);
    assert.equal(emailActionResponse(request, "evil.example/path", "key").status, 503);
    assert.equal(emailActionResponse(request).status, 503);
  }
});
