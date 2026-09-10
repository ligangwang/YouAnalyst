import { localizedMetadata } from "@/lib/i18n/server";

import { UiText } from "@/components/ui-text";
import type { Metadata } from "next";
import Link from "next/link";
import { aiChipsAnalystConfig } from "@/lib/ai-analyst/config";
import { SCORE_SCALE, TANH_SCALE } from "@/lib/predictions/analytics";

const pageMetadata: Metadata = {
  title: "How It Works | YouAnalyst",
  description: "Learn how to explore company connections, assess filing evidence, and track bullish or bearish calls in watchlists.",
  alternates: {
    canonical: "/how-it-works",
  },
};
export async function generateMetadata(): Promise<Metadata> { return localizedMetadata(pageMetadata); }

const lifecycle = [
  {
    status: "Live",
    description: "Active and updated daily.",
  },
  {
    status: "Settles at next close",
    description: "Your exit request is locked. Final settlement happens at the next end-of-day update.",
  },
  {
    status: "Settled",
    description: "Settled result and score are locked.",
  },
];

export default function HowItWorksPage() {
  const aiAnalystGuide = aiChipsAnalystConfig.publicContent.howItWorks;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <section className="border-b border-white/10 pb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-300"><UiText text={"How It Works"} /></p>
        <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"Follow a company from question to evidence."} /></h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300"><UiText text={"Find a company, inspect its suppliers, customers and competitors, then track your bullish or bearish outlook in a watchlist."} /></p>
      </section>

      <section className="grid gap-6 border-b border-white/10 py-6 md:grid-cols-3">
        <div><h2 className="text-lg font-semibold text-cyan-100"><UiText text={"Explore connections"} /></h2><p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Search for a company or choose one on the map. Use List view on a small screen, then select a relationship to inspect its sources."} /></p><Link href="/?company=NVDA" className="mt-3 inline-block text-cyan-200 underline"><UiText text={"Explore NVIDIA"} /></Link></div>
        <div><h2 className="text-lg font-semibold text-cyan-100"><UiText text={"Assess the evidence"} /></h2><p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Connections come from AI-assisted filing extraction and reviewed industry research. Check the linked source, date and company identity. Coverage is incomplete; an older source does not establish whether a relationship remains active."} /></p></div>
        <div><h2 className="text-lg font-semibold text-cyan-100"><UiText text={"Track your outlook"} /></h2><p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Choose Bullish or Bearish on a company, then sign in to review your call. Your first watchlist is created automatically; you can create more. Nothing is published until you confirm. Calls in public watchlists are visible to others."} /></p></div>
      </section>

      <section className="border-b border-white/10 py-6"><h2 className="text-xl font-semibold text-cyan-100"><UiText text={"Understand reported activity"} /></h2><p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Institutional holdings show a report date and filing date. Comparisons require a complete prior report; unavailable history is not a new purchase. Dollar-value changes include valuation changes. Insider transaction totals under review are excluded from rankings while their source filings remain available."} /></p></section>

      <section className="grid gap-4 border-b border-white/10 py-6 md:grid-cols-3">
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Make a prediction"} /></h2>
          <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Pick a stock, choose Bullish or Bearish, and confirm your watchlist. Reasoning and a time horizon are optional."} /></p>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Track the mark"} /></h2>
          <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"New predictions wait for their first completed end-of-day price to set the entry. After that, we update them daily."} /></p>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Close when ready"} /></h2>
          <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"When you close a live prediction, the exit request is locked and final settlement happens at the next end-of-day update, which runs around 9:00 PM ET on trading days."} /></p>
        </div>
      </section>

      <section className="border-b border-white/10 py-6">
        <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Status Guide"} /></h2>
        <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
          {lifecycle.map((item) => (
            <div key={item.status} className="grid gap-2 py-3 text-sm sm:grid-cols-[140px_1fr]">
              <p className="font-semibold text-cyan-200">{<UiText text={item.status} />}</p>
              <p className="leading-6 text-slate-300">{<UiText text={item.description} />}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 py-6 md:grid-cols-2">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"How Scores Work"} /></h2>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
            <p><UiText text={"Your Score reflects how your predictions perform from entry price to the latest end-of-day mark."} /></p>
            <p><UiText text={"Prediction score uses a capped curve:"} />{" "}
              <span className="font-mono text-xs text-cyan-100">
                round({SCORE_SCALE} * tanh(return / {TANH_SCALE}))
              </span>
              .
            </p>
            <p><UiText text={"Daily score is the change in prediction score from the previous market close. Because the curve flattens as a call gets further ahead, the same daily price move can add more score early and less score later."} /></p>
            <p><UiText text={"Rankings are based on overall Score across every open and settled public call."} /></p>
          </div>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Level & XP"} /></h2>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
            <p><UiText text={"You earn XP from settled predictions."} /></p>
            <p><UiText text={"XP increases your Level, which reflects your experience over time."} /></p>
            <p><UiText text={"Level does not affect ranking."} /></p>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 py-6">
        <div className="max-w-2xl">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Why End-of-Day"} /></h2>
          <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"End-of-day pricing keeps results consistent and comparable across all users."} /></p>
        </div>
      </section>

      <section className="grid gap-5 border-t border-white/10 py-6 md:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"AI Analyst Accounts"} /></h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{<UiText text={aiAnalystGuide.summary} />}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300"><UiText text={"Current Focus"} /></p>
              <p className="mt-2 font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"SMH-style chip basket"} /></p>
              <p className="mt-1 text-sm leading-6 text-slate-300"><UiText text={"The launch universe starts with a broader semiconductor and infrastructure basket instead of only a handful of names."} /></p>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300"><UiText text={"Run Limit"} /></p>
              <p className="mt-2 font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Up to 5 new calls"} /></p>
              <p className="mt-1 text-sm leading-6 text-slate-300"><UiText text={"It can also publish zero calls when no covered setup is strong enough."} /></p>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300"><UiText text={"Portfolio Limit"} /></p>
              <p className="mt-2 font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"20 open calls max"} /></p>
              <p className="mt-1 text-sm leading-6 text-slate-300"><UiText text={"It manages a bounded set of active ideas instead of opening unlimited positions."} /></p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {aiChipsAnalystConfig.coverage.tickers.map((ticker) => (
              <span
                key={ticker}
                className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-100"
              >
                {ticker}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-1">
          <div>
            <h3 className="text-sm font-semibold text-cyan-200"><UiText text={"Methodology"} /></h3>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {aiAnalystGuide.methodology.map((item) => (
                <p key={item}>{<UiText text={item} />}</p>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-cyan-200"><UiText text={"Rules"} /></h3>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {aiAnalystGuide.rules.map((item) => (
                <p key={item}>{<UiText text={item} />}</p>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-cyan-200"><UiText text={"Limitations"} /></h3>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {aiAnalystGuide.limitations.map((item) => (
                <p key={item}>{<UiText text={item} />}</p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-3 border-t border-white/10 pt-6">
        <Link
          href="/predictions/new"
          className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        ><UiText text={"Make a prediction"} /></Link>
        <Link
          href="/predictions"
          className="rounded-lg border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15"
        ><UiText text={"View feed"} /></Link>
      </section>
    </main>
  );
}
