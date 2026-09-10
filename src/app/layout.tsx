import type { Metadata } from "next";
import { IBM_Plex_Sans, Sora } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import { analyticsBootstrap } from "@/lib/analytics-bootstrap";
import { AppProviders } from "@/components/providers/app-providers";
import { EnvironmentBanner } from "@/components/environment-banner";
import { SiteNav } from "@/components/site-nav";
import { absoluteUrl, getSiteUrl, isProductionAppEnvironment, noIndexRobots } from "@/lib/seo";
import "./globals.css";

const GOOGLE_ANALYTICS_ID = process.env.GOOGLE_ANALYTICS_ID;

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: "YouAnalyst | Company research, connected.",
  description: "Explore company relationships, inspect filing evidence, and save companies for your next research session.",
  applicationName: "YouAnalyst",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "YouAnalyst",
    title: "YouAnalyst | Company research, connected.",
    description: "Follow source-linked market developments in a live feed, explore companies, and track your investment views.",
  },
  twitter: {
    card: "summary",
    title: "YouAnalyst | Company research, connected.",
    description: "Explore company relationships, inspect filing evidence, and save companies for your next research session.",
  },
  robots: isProductionAppEnvironment()
    ? {
        index: true,
        follow: true,
      }
    : noIndexRobots(),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "YouAnalyst",
    url: absoluteUrl("/"),
    description: "Explore company relationships, inspect filing evidence, and save companies for your next research session.",
  };

  return (
    <html
      lang="en"
      className={`${sora.variable} ${ibmPlexSans.variable} h-full antialiased`}
    >
      <head>
        <meta name="youanalyst-analytics" content="disabled" suppressHydrationWarning />
      </head>
      <body className="min-h-full flex flex-col">
        {GOOGLE_ANALYTICS_ID && isProductionAppEnvironment() ? (
          <Script id="google-analytics" strategy="beforeInteractive">
            {analyticsBootstrap(GOOGLE_ANALYTICS_ID, true)}
          </Script>
        ) : null}
        <Script id="website-jsonld" type="application/ld+json" strategy="beforeInteractive">
          {JSON.stringify(websiteJsonLd)}
        </Script>
        <AppProviders>
          <EnvironmentBanner />
          <a href="#page-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cyan-200 focus:p-3 focus:text-slate-950">Skip to content</a>
          <SiteNav />
          <div id="page-content" tabIndex={-1} className="flex-1">{children}</div>
          <footer className="border-t border-white/10 bg-slate-950/80">
            <div className="mx-auto w-full max-w-6xl px-4 py-4 text-center text-xs leading-6 text-slate-400">
              Predictions, rankings, and commentary on YouAnalyst are provided for informational purposes only and do
              not constitute financial, investment, legal, or tax advice. Always do your own research before making
              investment decisions.
              <div className="mt-3">
                <Link href="/how-it-works" className="mr-5 font-medium text-cyan-200 underline-offset-2 hover:underline">How it works</Link>
                <Link href="/feedback" className="font-medium text-cyan-200 underline-offset-2 hover:underline">
                  Share thoughts
                </Link>
              </div>
              <p className="mt-2 text-slate-500">Copyright {new Date().getFullYear()} YouAnalyst. All rights reserved.</p>
            </div>
          </footer>
        </AppProviders>
      </body>
    </html>
  );
}
