// Fixed categories only. Never send Firebase messages, arbitrary codes or account
// details to analytics. Credential failures share one category to avoid exposing
// whether an email belongs to an account.
export type AuthErrorReason = "account_exists" | "invalid_email" | "invalid_credentials" |
  "weak_password" | "rate_limited" | "network" | "popup_blocked" | "canceled" |
  "different_method" | "method_disabled" | "domain_not_allowed" | "unknown";

export function authErrorReason(error: unknown): AuthErrorReason {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  switch (code) {
    case "auth/email-already-in-use": return "account_exists";
    case "auth/invalid-email": return "invalid_email";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password": return "invalid_credentials";
    case "auth/weak-password": return "weak_password";
    case "auth/too-many-requests": return "rate_limited";
    case "auth/network-request-failed": return "network";
    case "auth/popup-blocked": return "popup_blocked";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return "canceled";
    case "auth/account-exists-with-different-credential": return "different_method";
    case "auth/operation-not-allowed": return "method_disabled";
    case "auth/unauthorized-domain": return "domain_not_allowed";
    default: return "unknown";
  }
}
