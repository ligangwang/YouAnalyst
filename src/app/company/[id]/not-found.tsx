import { headers } from "next/headers";
import { CompanyUnavailable } from "@/components/company-unavailable";

export default async function CompanyNotFound() {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-ya-pathname") ?? "";
  let label: string | undefined;
  try { label = decodeURIComponent(pathname.split("/").at(-1) ?? "").replace(/^ORG:/i, "").replace(/^ticker-/i, "").slice(0, 100) || undefined; }
  catch { /* A malformed URL can still show the recovery options. */ }
  return <CompanyUnavailable label={label} locale={requestHeaders.get("x-ya-language") === "zh-CN" ? "zh-CN" : "en"} />;
}
