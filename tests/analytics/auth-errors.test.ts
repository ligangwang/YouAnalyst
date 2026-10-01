import assert from "node:assert/strict";
import { test } from "node:test";
import { authErrorReason } from "../../src/lib/auth-error-reason";

test("authentication errors map only known codes to bounded categories", () => {
  const cases = {
    "auth/email-already-in-use": "account_exists",
    "auth/invalid-email": "invalid_email",
    "auth/invalid-credential": "invalid_credentials",
    "auth/user-not-found": "invalid_credentials",
    "auth/wrong-password": "invalid_credentials",
    "auth/weak-password": "weak_password",
    "auth/too-many-requests": "rate_limited",
    "auth/network-request-failed": "network",
    "auth/popup-blocked": "popup_blocked",
    "auth/popup-closed-by-user": "canceled",
    "auth/cancelled-popup-request": "canceled",
    "auth/account-exists-with-different-credential": "different_method",
    "auth/operation-not-allowed": "method_disabled",
    "auth/unauthorized-domain": "domain_not_allowed",
  };
  for (const [code, reason] of Object.entries(cases)) {
    assert.equal(authErrorReason({ code, message: "private@example.invalid", customData: { email: "private@example.invalid" } }), reason);
  }
});

test("unknown codes and free-form errors never become analytics values", () => {
  for (const error of [
    null, undefined, "private@example.invalid", new Error("Unable to create user profile."),
    { code: "private@example.invalid", message: "auth/network-request-failed" },
    { code: "toString" }, { code: "__proto__" }, { code: 42 },
  ]) assert.equal(authErrorReason(error), "unknown");
});
