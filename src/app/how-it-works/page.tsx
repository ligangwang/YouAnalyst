import type { Metadata } from "next";
import Link from "next/link";
import { aiChipsAnalystConfig } from "@/lib/ai-analyst/config";
import { SCORE_SCALE, TANH_SCALE } from "@/lib/predictions/analytics";

export const metadata: Metadata = {
  title: "How It Works | YouAnalyst",
  description: "Learn how YouAnalyst predictions, watchlists, scores, XP, and settlement rules work.",
  alternates: {
    canonical: "/how-it-works",
  },
};

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
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">How It Works</p>
        <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100">
          Predictions run on end-of-day prices.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Make predictions on stocks. We track results using end-of-day prices to keep everything fair and consistent.
        </p>
      </section>

      <section className="grid gap-4 border-b border-white/10 py-6 md:grid-cols-3">
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Make a prediction</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Pick a stock, choose Up or Down, and share your view.
          </p>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Track the mark</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            New predictions wait for their first completed end-of-day price to set the entry. After that, we update them daily.
          </p>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Close when ready</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            When you close a live prediction, the exit request is locked and final settlement happens at the next end-of-day update, which runs around 9:00 PM ET on trading days.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10 py-6">
        <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Status Guide</h2>
        <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
          {lifecycle.map((item) => (
            <div key={item.status} className="grid gap-2 py-3 text-sm sm:grid-cols-[140px_1fr]">
              <p className="font-semibold text-cyan-200">{item.status}</p>
              <p className="leading-6 text-slate-300">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 py-6 md:grid-cols-2">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">How Scores Work</h2>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
            <p>Your Score reflects how your predictions perform from entry price to the latest end-of-day mark.</p>
            <p>
              Prediction score uses a capped curve:{" "}
              <span className="font-mono text-xs text-cyan-100">
                round({SCORE_SCALE} * tanh(return / {TANH_SCALE}))
              </span>
              .
            </p>
            <p>
              Daily score is the change in prediction score from the previous market close. Because the curve flattens
              as a call gets further ahead, the same daily price move can add more score early and less score later.
            </p>
            <p>Rankings are based on overall Score across every open and settled public call.</p>
          </div>
        </div>
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Level & XP</h2>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
            <p>You earn XP from settled predictions.</p>
            <p>XP increases your Level, which reflects your experience over time.</p>
            <p>Level does not affect ranking.</p>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 py-6">
        <div className="max-w-2xl">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Why End-of-Day</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            End-of-day pricing keeps results consistent and comparable across all users.
          </p>
        </div>
      </section>

      <section className="grid gap-5 border-t border-white/10 py-6 md:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">AI Analyst Accounts</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{aiAnalystGuide.summary}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Current Focus</p>
              <p className="mt-2 font-[var(--font-sora)] text-lg font-semibold text-cyan-100">SMH-style chip basket</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">The launch universe starts with a broader semiconductor and infrastructure basket instead of only a handful of names.</p>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Run Limit</p>
              <p className="mt-2 font-[var(--font-sora)] text-lg font-semibold text-cyan-100">Up to 5 new calls</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">It can also publish zero calls when no covered setup is strong enough.</p>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Portfolio Limit</p>
              <p className="mt-2 font-[var(--font-sora)] text-lg font-semibold text-cyan-100">20 open calls max</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">It manages a bounded set of active ideas instead of opening unlimited positions.</p>
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
            <h3 className="text-sm font-semibold text-cyan-200">Methodology</h3>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {aiAnalystGuide.methodology.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-cyan-200">Rules</h3>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {aiAnalystGuide.rules.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-cyan-200">Limitations</h3>
            <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
              {aiAnalystGuide.limitations.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-3 border-t border-white/10 pt-6">
        <Link
          href="/predictions/new"
          className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        >
          Make a prediction
        </Link>
        <Link
          href="/predictions"
          className="rounded-lg border border-cyan-400/35 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15"
        >
          View feed
        </Link>
      </section>
    </main>
  );
}
