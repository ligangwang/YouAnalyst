import type { Metadata } from "next";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { StockComparePage } from "@/components/stock-compare-page";
import { comparePath } from "@/lib/compare";
import { localizedMetadata } from "@/lib/ui/i18n/server";
import { resolveCompareLanding, withCommunityViewerVotes } from "@/lib/compare-community-service";
import { verifyMember } from "@/lib/access/member";
import { MEMBER_COOKIE } from "@/lib/access/policy";
import { verifiedReleaseProbe } from "@/lib/access/release-probe";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const configFrom = cache((query: string) => resolveCompareLanding(new URLSearchParams(query)));
async function landingFrom(props: Props) {
  const query = await props.searchParams;
  return configFrom(new URLSearchParams(Object.entries(query).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : Array.isArray(value) ? value.map(item => [key, item]) : [])).toString());
}
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { config } = await landingFrom(props);
  const title = `${config.symbols.join(" vs ")} | YouAnalyst Animated Stock Performance Comparison`;
  const description = `Replay stock price returns from ${config.start} to ${config.end}. Choose a line race or bar race and share your comparison.`;
  const image = `/api/compare/share-image?${comparePath(config).split("?")[1]}`;
  return localizedMetadata({ title, description, alternates: { canonical: "/compare" }, openGraph: { title, description, images: [{ url: image, width: 1200, height: 630, alt: title }] }, twitter: { card: "summary_large_image", title, description, images: [image] } });
}
export default async function Page(props: Props) {
  const { config: initial, featured, initialPage } = await landingFrom(props);
  let initialCommunityPage;
  if (initialPage) {
    const token = (await cookies()).get(MEMBER_COOKIE)?.value;
    const member = token ? await verifyMember(token) : null;
    if (member) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        initialCommunityPage = await Promise.race([
          withCommunityViewerVotes(initialPage, member.uid),
          new Promise<undefined>(resolve => { timeout = setTimeout(resolve, 500); }),
        ]);
      } catch { /* The browser can retry through the existing list API. */ }
      finally { clearTimeout(timeout); }
    } else {
      const requestHeaders = await headers();
      const origin = new URL(requestHeaders.get("x-forwarded-proto") === "http" ? "http://localhost" : "https://localhost");
      if (verifiedReleaseProbe({ method: "GET", headers: requestHeaders, nextUrl: origin })) initialCommunityPage = initialPage;
    }
  }
  return <StockComparePage key={comparePath(initial)} initial={initial} featured={featured} initialCommunityPage={initialCommunityPage}/>;
}
