import type { Metadata } from "next";
import { HomeIntroduction } from "@/components/home-introduction";
import { localizedMetadata } from "@/lib/ui/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata({
    title: "YouAnalyst | Company Research and Investment Ideas",
    description: "Research companies, explore their connections, and build your investment view.",
    alternates: { canonical: "/" },
  });
}

export default function Home() {
  return <HomeIntroduction />;
}
