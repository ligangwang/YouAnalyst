import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseLocale } from "@/lib/locale";
import { localizedPath } from "@/lib/ui/i18n/urls";

// Compatibility for bookmarks: Explore now contains the feed.
export default async function FeedPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = parseLocale((await headers()).get("x-ya-language")) ?? "en";
  const params = await searchParams;
  if (params.scope === "following") redirect(localizedPath("/watchlists/following?view=updates", locale));
  const query = new URLSearchParams();
  for (const key of ["theme", "company", "q", "event", "relationship", "market", "view"]) {
    if (typeof params[key] === "string") query.set(key, params[key]);
  }
  if (query.get("view") === "filings") query.set("view", "graph");
  redirect(`${localizedPath("/", locale)}${query.size ? "?" + query : ""}`);
}
