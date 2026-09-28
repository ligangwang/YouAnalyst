import { localizedMetadata } from "@/lib/i18n/server";

import { UiText } from "@/components/ui-text";
import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/localized-link";
import { CompanySearchCard } from "@/components/company-search-card";
import { MostConnectedCompanies } from "@/components/most-connected-companies";
import { MarketTicker } from "@/components/market-ticker";

export const dynamic = "force-dynamic";

const pageMetadata: Metadata = {
  title: "Company search | YouAnalyst",
  description: "Search a company or ticker on YouAnalyst.",
  alternates: {
    canonical: "/companies",
  },
  openGraph: {
    title: "Company search | YouAnalyst",
    description: "Search a company or ticker on YouAnalyst.",
    url: "/companies",
  },
  twitter: {
    title: "Company search | YouAnalyst",
    description: "Search a company or ticker on YouAnalyst.",
  },
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

// Suggestions are companies on the AI map, so every chip leads to documented supply-chain research.
const suggestedCompanies = [
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "TSM", name: "TSMC" },
  { symbol: "AVGO", name: "Broadcom" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "AMD", name: "AMD" },
];

export default function CompaniesPage() {
  return (
    <>
    <MarketTicker />
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col px-4 pt-10 pb-8 sm:pt-16 lg:pt-20">
      <section className="w-full">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-2xl font-semibold text-slate-50 sm:text-3xl"><UiText text={"Company search"} /></h1>
          <p className="mt-2 text-sm text-slate-400"><UiText text={"Search companies by name or ticker."} /></p>
        </div>

        <CompanySearchCard />

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {suggestedCompanies.map((company) => (
            <Link
              key={company.symbol}
              href={`/ticker/${company.symbol}`}
              data-testid="company-graph-chip"
              className="rounded-full border border-white/10 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-500/10"
            >
              {company.symbol}
              <span className="ml-2 font-normal text-slate-400">{company.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <MostConnectedCompanies />
    </main>
    </>
  );
}
