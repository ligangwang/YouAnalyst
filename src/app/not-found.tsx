import { headers } from "next/headers";
import CompanyNotFound from "./company/[id]/not-found";
import { UiText } from "@/components/ui-text";
import { LocalizedLink as Link } from "@/components/localized-link";

export default async function NotFound() {
  const pathname = (await headers()).get("x-ya-pathname") ?? "";
  if (pathname.startsWith("/company/")) return <CompanyNotFound />;
  return <main className="mx-auto w-full max-w-3xl px-6 py-16">
    <section className="company-profile-header rounded-2xl border p-8">
      <h1 className="text-3xl font-semibold text-slate-50"><UiText text="Page not found" /></h1>
      <p className="mt-4 text-slate-300"><UiText text="The page you requested is not available." /></p>
      <Link href="/" className="mt-6 inline-block text-cyan-200 underline underline-offset-4"><UiText text="Explore companies" /> →</Link>
    </section>
  </main>;
}
