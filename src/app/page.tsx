import type { Metadata } from "next";
import CompaniesPage from "@/app/companies/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company search | YouAnalyst",
  description: "Search a company, ticker, or institution on YouAnalyst.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Company search | YouAnalyst",
    description: "Search a company, ticker, or institution on YouAnalyst.",
    url: "/",
  },
  twitter: {
    title: "Company search | YouAnalyst",
    description: "Search a company, ticker, or institution on YouAnalyst.",
  },
};

export default function Home() {
  return <CompaniesPage />;
}
