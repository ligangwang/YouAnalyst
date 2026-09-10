import { localizedMetadata } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";
import { noIndexRobots } from "@/lib/seo";

const pageMetadata: Metadata = {
  title: "Sign in | YouAnalyst",
  description: "Sign in to create watchlists, publish stock calls, and build your public track record.",
  robots: noIndexRobots(),
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

export default async function AuthRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; mode?: string | string[] }>;
}) {
  const { next, mode } = await searchParams;
  return <AuthPage requestedNext={Array.isArray(next) ? next[0] : next} initialCreate={mode === "register"} />;
}
