import type { Metadata } from "next";
import CompaniesPage from "@/app/companies/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Institutional holdings | YouAnalyst",
  description: "Search a ticker to view institutional 13F holdings and public calls on YouAnalyst.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Institutional holdings | YouAnalyst",
    description: "Search a ticker to view institutional 13F holdings and public calls on YouAnalyst.",
    url: "/",
  },
  twitter: {
    title: "Institutional holdings | YouAnalyst",
    description: "Search a ticker to view institutional 13F holdings and public calls on YouAnalyst.",
  },
};

export default function Home() {
  return <CompaniesPage />;
}
