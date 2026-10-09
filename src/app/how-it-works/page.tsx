import { localizedMetadata } from "@/lib/i18n/server";

import { UiText } from "@/components/ui-text";
import type { Metadata } from "next";
import Link from "next/link";
import { SCORE_SCALE, TANH_SCALE } from "@/lib/predictions/analytics";
import { SHOW_ANALYST_LEVELS } from "@/lib/community";

const pageMetadata: Metadata = {
  title: "How It Works | YouAnalyst",
  description: "Learn how to explore company connections, assess their sources, and publish evidence-backed analyst views.",
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
    description: "Settled return and score are locked.",
  },
];

export default function HowItWorksPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <section className="border-b border-white/10 pb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-300"><UiText text={"How It Works"} /></p>
        <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100"><UiText text={"Follow a company from question to sources."} /></h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300"><UiText text={"Find a company, inspect its documented suppliers, customers and partners, and check every relationship against its sources. Analyst views build on that research."} /></p>
      </section>

      <section aria-labelledby="research-heading" className="border-b border-white/10 py-6">
        <h2 id="research-heading" className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Research"} /></h2>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          <div><h3 className="text-lg font-semibold text-cyan-100"><UiText text={"Explore connections"} /></h3><p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Search for a company or choose one on the map. Use List view on a small screen, then select a relationship to inspect its sources."} /></p><Link href="/?company=NVDA" className="mt-3 inline-block text-cyan-200 underline"><UiText text={"Explore NVIDIA"} /></Link></div>
          <div><h3 className="text-lg font-semibold text-cyan-100"><UiText text={"Assess the sources"} /></h3><p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Connections come from AI-assisted filing extraction and reviewed industry research. Check the linked source, date and company identity. Coverage is incomplete; an older source does not establish whether a relationship remains active."} /></p></div>
          <div><h3 className="text-lg font-semibold text-cyan-100"><UiText text={"Read the deep-dives"} /></h3><p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Research deep-dives follow one ecosystem or bottleneck and separate what has shipped from what is only announced."} /></p><Link href="/research" className="mt-3 inline-block text-cyan-200 underline"><UiText text={"Research deep-dives"} /></Link></div>
        </div>
      </section>

      <section aria-labelledby="views-heading" className="border-b border-white/10 py-6">
        <h2 id="views-heading" className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100"><UiText text={"Analyst views"} /></h2>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          <div>
            <h3 className="text-lg font-semibold text-cyan-100"><UiText text={"Publish a view"} /></h3>
            <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Choose a company on the AI, Robotics or Space maps and write your thesis. A bullish or bearish view cites at least one documented relationship or research deep-dive it builds on; research-only posts can cite sources too."} /></p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-cyan-100"><UiText text={"Track the mark"} /></h3>
            <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"New views wait for their first completed end-of-day price to set the entry. After that, we update them daily. Close a view when your thesis changes; settlement happens at the next end-of-day update, around 9:00 PM ET on trading days."} /></p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-cyan-100"><UiText text={"Build a track record"} /></h3>
            <p className="mt-2 text-sm leading-6 text-slate-300"><UiText text={"Each analyst profile lists every public view with its return beside the Nasdaq-100 (QQQ) over the same dates, so a record can be checked view by view."} /></p>
          </div>
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
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300"><UiText text={"End-of-day pricing keeps results consistent and comparable across all analysts."} /></p>
      </section>

      <details className="py-6 text-sm text-slate-300">
        <summary className="cursor-pointer font-semibold text-cyan-100"><UiText text={"Score details"} /></summary>
        <div className="mt-3 max-w-3xl space-y-2 leading-6">
          <p><UiText text={"Each view also carries a score of how it performed from entry price to the latest end-of-day mark."} /></p>
          <p><UiText text={"View score uses a capped curve:"} />{" "}
            <span className="font-mono text-xs text-cyan-100">round({SCORE_SCALE} * tanh(return / {TANH_SCALE}))</span>.
          </p>
          <p><UiText text={"Daily score is the change in view score from the previous market close. Because the curve flattens as a view gets further ahead, the same daily price move can add more score early and less score later."} /></p>
          {SHOW_ANALYST_LEVELS ? <p><UiText text={"You earn XP from settled views. XP increases your Level, which reflects your experience over time."} /></p> : null}
        </div>
      </details>

      <section className="flex flex-wrap gap-3 border-t border-white/10 pt-6">
        <Link href="/" className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"><UiText text={"Explore the map"} /></Link>
        <Link href="/predictions" className="rounded-lg border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15"><UiText text={"Read analyst views"} /></Link>
      </section>
    </main>
  );
}
