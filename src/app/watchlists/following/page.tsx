import { FollowedCompaniesPage } from "@/components/followed-companies-page";
export const metadata = { title: "Watchlist | YouAnalyst", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return <FollowedCompaniesPage feed={(await searchParams).view === "updates"} />;
}
