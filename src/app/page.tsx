import type { Metadata } from "next";
import CompaniesPage from "@/app/companies/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "YouAnalyst | Stock Research, Predictions, Watchlists, and Ownership Signals",
  description:
    "Search public companies, publish stock predictions, compare analyst track records, and research institutional ownership, insider activity, and watchlists.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "YouAnalyst | Stock Research, Predictions, Watchlists, and Ownership Signals",
    description:
      "Search public companies, publish stock predictions, compare analyst track records, and research institutional ownership, insider activity, and watchlists.",
    url: "/",
  },
  twitter: {
    title: "YouAnalyst | Stock Research, Predictions, Watchlists, and Ownership Signals",
    description:
      "Search public companies, publish stock predictions, compare analyst track records, and research institutional ownership, insider activity, and watchlists.",
  },
};

export default function Home() {
  return <CompaniesPage />;
}
