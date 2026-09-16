import { trackEvent, trackFollowingVisit } from "./analytics";
import { safeAuthDestination } from "./auth-continuation";

export function validFollowCompany(id: string): boolean {
  return /^(US:[A-Z0-9.-]{1,16}|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(id);
}
export function companyFollowIntent(next: string | null | undefined) {
  const safe = safeAuthDestination(next);
  if (!safe) return null;
  const url = new URL(safe, "https://youanalyst.invalid");
  const companyId = url.searchParams.get("followCompany");
  if (!companyId || !validFollowCompany(companyId)) return null;
  url.searchParams.delete("followCompany");
  return { companyId, destination: url.pathname + url.search + url.hash };
}
export function companyFollowSignIn(companyId: string, location: string) {
  if (!validFollowCompany(companyId)) throw new Error("Invalid company");
  const url = new URL(safeAuthDestination(location) ?? "/", "https://youanalyst.invalid");
  url.searchParams.set("followCompany", companyId);
  return `/auth?${new URLSearchParams({ next: url.pathname + url.search + url.hash, mode: "register" })}`;
}
export async function persistCompanyFollow(companyId: string, follow: boolean, getToken: () => Promise<string | null>) {
  const token = await getToken();
  if (!token) throw new Error("Sign in required");
  const response = await fetch("/api/map-follows", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ companyId, follow }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Follow could not be saved");
  const data = await response.json();
  if (!Array.isArray(data.companyIds) || data.companyIds.includes(companyId) !== follow) throw new Error("Follow not confirmed");
  trackEvent(follow ? "company_follow" : "company_unfollow");
  if (follow) trackFollowingVisit(Date.now(), true);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("company-follows-changed"));
  return data.companyIds as string[];
}
