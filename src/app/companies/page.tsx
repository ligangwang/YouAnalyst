import { companyDirectory, companyPath } from "@/lib/companies";
import type { Metadata } from "next";
import Link from "next/link";
import { CompanySearchCard } from "@/components/company-search-card";
import { randomFeaturedCompanies } from "@/lib/featured-companies";
import { absoluteUrl, jsonLd } from "@/lib/seo";
import { researchPages } from "@/lib/research-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company Search and Stock Research | YouAnalyst",
  description:
    "Search public companies, tickers, institutions, stock predictions, 13F ownership changes, insider activity, and watchlists on YouAnalyst.",
  alternates: {
    canonical: "/companies",
  },
  openGraph: {
    title: "Company Search and Stock Research | YouAnalyst",
    description:
      "Search public companies, tickers, institutions, stock predictions, 13F ownership changes, insider activity, and watchlists on YouAnalyst.",
    url: "/companies",
  },
  twitter: {
    title: "Company Search and Stock Research | YouAnalyst",
    description:
      "Search public companies, tickers, institutions, stock predictions, 13F ownership changes, insider activity, and watchlists on YouAnalyst.",
  },
};

export default function CompaniesPage() {
  const featuredCompanies = randomFeaturedCompanies();
  const searchJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Company Search and Stock Research",
    description: metadata.description,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: researchPages.map((page, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: absoluteUrl(`/research/${page.slug}`),
        name: page.shortTitle,
      })),
    },
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pt-16 pb-10 sm:pt-20 lg:pt-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(searchJsonLd) }}
      />
      <section className="w-full">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">Stock Research Search</p>
          <h1 className="mt-3 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-5xl">
            Search companies, tickers, institutions, and market signals.
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
            Find public company pages with stock predictions, analyst watchlists, institutional 13F ownership
            changes, insider transactions, and relationship context.
          </p>
        </div>

        <CompanySearchCard />

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {featuredCompanies.map((company) => (
            <Link
              key={company.symbol}
              href={companyPath(company.symbol)}
              data-testid="company-graph-chip"
              className="rounded-full border border-white/10 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-500/10"
            >
              {company.symbol}
              <span className="ml-2 font-normal text-slate-400">{company.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-white/10 pt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Company directory</p>
        <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-white">Explore major companies</h2>
        <p className="mt-2 text-sm text-slate-400">Open a company profile to research its disclosed relationships, ownership, and market activity. Relationship coverage varies by company.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {companyDirectory.map((company) => (
            <Link key={company.symbol} href={companyPath(company.symbol)} className="group rounded-xl border border-white/10 bg-slate-900/55 p-4 transition hover:border-cyan-400/40 hover:bg-cyan-400/5">
              <div className="flex items-center justify-between text-xs"><span className="font-semibold text-cyan-300">{company.symbol}</span><span aria-hidden="true" className="text-slate-500 group-hover:text-cyan-200">↗</span></div>
              <h3 className="mt-3 font-semibold text-white">{company.name}</h3>
              <p className="mt-1 text-xs text-slate-400">{company.sector}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 border-b border-white/10 border-t border-white/10 py-8 mt-10 md:grid-cols-3">
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Public stock predictions</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Review market calls by ticker and compare analyst track records against end-of-day price outcomes.
          </p>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Institutional ownership</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Connect companies to 13F filing changes, institution pages, followed manager activity, and daily
            ownership move discovery.
          </p>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Insider transactions</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Research insider buying and selling activity alongside predictions, watchlists, and other company
            context.
          </p>
        </div>
      </section>

      <section className="py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">Research Topics</p>
            <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">
              Learn how to read YouAnalyst market signals.
            </h2>
          </div>
          <Link href="/research" className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
            All guides
          </Link>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {researchPages.map((page) => (
            <Link
              key={page.slug}
              href={`/research/${page.slug}`}
              className="rounded-lg border border-white/10 bg-slate-950/55 p-4 hover:border-cyan-300/45 hover:bg-cyan-500/10"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">{page.eyebrow}</p>
              <h3 className="mt-2 font-semibold text-cyan-100">{page.shortTitle}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{page.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
