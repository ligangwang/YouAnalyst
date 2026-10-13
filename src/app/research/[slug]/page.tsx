import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { absoluteUrl, jsonLd } from "@/lib/seo";
import { findResearchPage, researchPages } from "@/lib/research-content";

type ResearchPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return researchPages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: ResearchPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = findResearchPage(slug);

  if (!page) {
    return {};
  }

  return {
    title: `${page.shortTitle} | YouAnalyst`,
    description: page.description,
    alternates: {
      canonical: `/research/${page.slug}`,
    },
    openGraph: {
      title: `${page.shortTitle} | YouAnalyst`,
      description: page.description,
      url: `/research/${page.slug}`,
      type: "article",
    },
    twitter: {
      title: `${page.shortTitle} | YouAnalyst`,
      description: page.description,
    },
  };
}

export default async function ResearchGuidePage({ params }: ResearchPageProps) {
  const { slug } = await params;
  const page = findResearchPage(slug);

  if (!page) {
    notFound();
  }

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.description,
    mainEntityOfPage: absoluteUrl(`/research/${page.slug}`),
    publisher: {
      "@type": "Organization",
      name: "YouAnalyst",
    },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(faqJsonLd) }}
      />
      <Link href="/research" className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
        Research guides
      </Link>

      <article className="mt-6">
        <header className="border-b border-white/10 pb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">{page.eyebrow}</p>
          <h1 className="mt-2 max-w-4xl font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-4xl">
            {page.title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">{page.intro}</p>
          <Link
            href={page.primaryHref}
            className="mt-5 inline-flex rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            {page.primaryCta}
          </Link>
        </header>

        <section className="grid gap-6 border-b border-white/10 py-8">
          {page.sections.map((section) => (
            <div key={section.heading} className="max-w-3xl">
              <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">{section.heading}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">{section.body}</p>
            </div>
          ))}
        </section>

        <section className="border-b border-white/10 py-8">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Frequently Asked Questions</h2>
          <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
            {page.faqs.map((item) => (
              <div key={item.question} className="py-4">
                <h3 className="font-semibold text-cyan-200">{item.question}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-8">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Continue Researching</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {page.relatedLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg border border-white/10 bg-slate-950/55 p-4 hover:border-cyan-300/45 hover:bg-cyan-500/10"
              >
                <h3 className="font-semibold text-cyan-100">{link.label}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{link.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </article>
    </main>
  );
}
