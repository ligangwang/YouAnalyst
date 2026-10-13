import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl, jsonLd } from "@/lib/seo";
import { researchPages } from "@/lib/research-content";

export const metadata: Metadata = {
  title: "Stock Research Guides | YouAnalyst",
  description:
    "Research public companies with YouAnalyst guides for stock predictions, institutional ownership, 13F tracking, insider activity, and watchlists.",
  alternates: {
    canonical: "/research",
  },
  openGraph: {
    title: "Stock Research Guides | YouAnalyst",
    description:
      "Research public companies with YouAnalyst guides for stock predictions, institutional ownership, 13F tracking, insider activity, and watchlists.",
    url: "/research",
  },
  twitter: {
    title: "Stock Research Guides | YouAnalyst",
    description:
      "Research public companies with YouAnalyst guides for stock predictions, institutional ownership, 13F tracking, insider activity, and watchlists.",
  },
};

export default function ResearchIndexPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Stock Research Guides",
    description: metadata.description,
    hasPart: researchPages.map((page) => ({
      "@type": "Article",
      headline: page.title,
      description: page.description,
      url: absoluteUrl(`/research/${page.slug}`),
    })),
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(collectionJsonLd) }}
      />
      <section className="border-b border-white/10 pb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">Research Guides</p>
        <h1 className="mt-2 max-w-3xl font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-4xl">
          Stock research pages for predictions, ownership, insiders, and watchlists.
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
          Use these guides to understand how YouAnalyst organizes public market calls, ticker research,
          institutional ownership changes, insider trading activity, and analyst watchlists.
        </p>
      </section>

      <section className="grid gap-4 py-8 md:grid-cols-3">
        {researchPages.map((page) => (
          <article key={page.slug} className="rounded-lg border border-white/10 bg-slate-950/55 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">{page.eyebrow}</p>
            <h2 className="mt-2 font-[var(--font-sora)] text-lg font-semibold text-cyan-100">
              <Link href={`/research/${page.slug}`} className="hover:text-cyan-200">
                {page.shortTitle}
              </Link>
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">{page.description}</p>
            <Link
              href={`/research/${page.slug}`}
              className="mt-4 inline-flex text-sm font-semibold text-cyan-200 hover:text-cyan-100"
            >
              Read guide
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
