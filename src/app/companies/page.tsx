import { localizedMetadata } from "@/lib/ui/i18n/server";

import { UiText } from "@/components/ui-text";
import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/localized-link";
import { CompanySearchCard } from "@/components/company-search-card";
import { MostConnectedCompanies } from "@/components/most-connected-companies";
import { inventoryCompanyPath } from "@/lib/market-companies/slug-inventory";
import { companyPageUrl } from "@/lib/market-companies/routes";
import styles from "@/components/basic-pages.module.css";

export const dynamic = "force-dynamic";

const pageMetadata: Metadata = {
  title: "Company & Stock Research | YouAnalyst",
  description: "Search any company or ticker for its business, financials, earnings and analyst views.",
  alternates: {
    canonical: "/companies",
  },
  openGraph: {
    title: "Company & Stock Research | YouAnalyst",
    description: "Search any company or ticker for its business, financials, earnings and analyst views.",
    url: "/companies",
  },
  twitter: {
    title: "Company & Stock Research | YouAnalyst",
    description: "Search any company or ticker for its business, financials, earnings and analyst views.",
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
    <main className={styles.companies}>
      <h1><UiText text="Companies" /></h1>
      <section className={styles.searchArea}>
        <CompanySearchCard />

        <div className={styles.suggestions}>
          {suggestedCompanies.map((company) => (
            <Link
              key={company.symbol}
              href={inventoryCompanyPath(`US:${company.symbol}`) ?? companyPageUrl(company.symbol, "US")}
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
  );
}
