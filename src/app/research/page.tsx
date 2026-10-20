import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseLocale } from "@/lib/locale";
import { localizedPath } from "@/lib/ui/i18n/urls";

// Keep existing bookmarks working after retiring the Research landing page.
export default async function ResearchPage() {
  const locale = parseLocale((await headers()).get("x-ya-language")) ?? "en";
  redirect(localizedPath("/?view=graph", locale));
}
