export type ResearchPage = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  eyebrow: string;
  intro: string;
  primaryHref: string;
  primaryCta: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
  faqs: Array<{
    question: string;
    answer: string;
  }>;
  relatedLinks: Array<{
    href: string;
    label: string;
    description: string;
  }>;
};

export const researchPages: ResearchPage[] = [
  {
    slug: "company-stock-research",
    title: "Company Stock Research With Public Calls and Ownership Signals",
    shortTitle: "Company Stock Research",
    description:
      "Use YouAnalyst to research public companies through stock predictions, watchlists, institutional holdings, insider activity, and daily market calls.",
    eyebrow: "Company Research",
    intro:
      "A useful stock research page should connect the company, the market view, and the ownership signals around it. YouAnalyst brings those pieces together so investors can compare public calls, watchlists, institutional 13F activity, insider transactions, and company relationship maps from one ticker page.",
    primaryHref: "/companies",
    primaryCta: "Search companies",
    sections: [
      {
        heading: "Start with the ticker, then read the surrounding signals",
        body:
          "Ticker pages collect public predictions, watchlist appearances, institutional holding changes, and company graph context. That makes them useful for researching a stock before writing a call, reviewing a thesis, or comparing how other analysts are tracking the same company.",
      },
      {
        heading: "Compare stock predictions against actual outcomes",
        body:
          "YouAnalyst predictions use end-of-day prices, so calls can be compared on a consistent basis. The public track record helps separate a well-timed thesis from a popular story that did not work in the market.",
      },
      {
        heading: "Use watchlists as research context",
        body:
          "Public watchlists show how analysts group companies by theme, sector, catalyst, or risk. A ticker that appears across several watchlists may be part of a broader market conversation worth investigating.",
      },
    ],
    faqs: [
      {
        question: "What can I research on a YouAnalyst ticker page?",
        answer:
          "Ticker pages can show public calls, watchlist context, institutional 13F holding changes, insider transaction activity, and company relationship data when available.",
      },
      {
        question: "Are YouAnalyst stock predictions investment advice?",
        answer:
          "No. YouAnalyst is for informational research, public track records, and market discussion. It does not provide financial, investment, legal, or tax advice.",
      },
      {
        question: "Why does YouAnalyst use end-of-day prices?",
        answer:
          "End-of-day pricing makes prediction tracking more consistent across users and reduces noise from intraday price swings.",
      },
    ],
    relatedLinks: [
      {
        href: "/predictions",
        label: "Public prediction feed",
        description: "Browse recent stock calls and see how analysts are expressing market views.",
      },
      {
        href: "/watchlists",
        label: "Public watchlists",
        description: "Find thematic stock lists and compare how companies are grouped.",
      },
      {
        href: "/how-it-works",
        label: "Scoring methodology",
        description: "Learn how entries, exits, scores, XP, and settlement rules work.",
      },
    ],
  },
  {
    slug: "institutional-ownership-13f-tracking",
    title: "Institutional Ownership and 13F Tracking for Stock Research",
    shortTitle: "Institutional Ownership",
    description:
      "Track institutional ownership, 13F filing changes, increased positions, reduced positions, and followed institution digests on YouAnalyst.",
    eyebrow: "Institutional Signals",
    intro:
      "Institutional ownership data helps investors see how large filers are changing exposure over time. YouAnalyst turns 13F activity into searchable institution pages, ticker-level holding context, and daily institutional move feeds.",
    primaryHref: "/institutions",
    primaryCta: "Explore institutions",
    sections: [
      {
        heading: "Follow 13F filers and watch position changes",
        body:
          "Institution pages help you inspect filed holdings and follow managers whose moves you want to review. For long-term research, the most useful signal is often the direction and persistence of position changes rather than a single filing in isolation.",
      },
      {
        heading: "Connect holdings back to tickers",
        body:
          "A ticker page can surface institutional activity around a company, helping you compare public analyst calls with recent ownership changes from large filers.",
      },
      {
        heading: "Use daily institutional moves for discovery",
        body:
          "The daily institutional feed highlights notable increases, reductions, new positions, and exits. It is designed for discovery, so you can identify companies that deserve deeper research.",
      },
    ],
    faqs: [
      {
        question: "What is a 13F filing?",
        answer:
          "A 13F filing is a quarterly disclosure from certain institutional investment managers that reports many U.S.-listed equity holdings.",
      },
      {
        question: "Can 13F data show what an institution owns today?",
        answer:
          "No. 13F data is delayed and should be treated as historical disclosure, not a live portfolio. It is most useful when compared across filing periods.",
      },
      {
        question: "How can I use institutional ownership in research?",
        answer:
          "Look for repeated buying, reductions, new positions, exits, and overlap between institutions, then compare those signals with company fundamentals, public calls, and your own thesis.",
      },
    ],
    relatedLinks: [
      {
        href: "/daily/institutional",
        label: "Daily institutional moves",
        description: "Review notable 13F-related ownership changes by date.",
      },
      {
        href: "/institutions",
        label: "Institution search",
        description: "Find institutional filers and follow the managers you care about.",
      },
      {
        href: "/companies",
        label: "Company search",
        description: "Search a ticker to connect ownership activity back to company research.",
      },
    ],
  },
  {
    slug: "insider-trading-activity",
    title: "Insider Trading Activity for Public Company Research",
    shortTitle: "Insider Trading Activity",
    description:
      "Research insider buying, insider selling, transaction value, filing context, and daily insider activity on YouAnalyst.",
    eyebrow: "Insider Signals",
    intro:
      "Insider transactions can add useful context to public company research when they are read carefully. YouAnalyst organizes insider activity by ticker and daily signal so investors can compare buying, selling, and transaction value alongside predictions and ownership data.",
    primaryHref: "/daily/insiders",
    primaryCta: "View insider activity",
    sections: [
      {
        heading: "Separate signal from routine transactions",
        body:
          "Not every insider trade is meaningful. Research is stronger when transaction size, role, timing, ownership history, and repeated activity are considered together instead of treating every filing as a headline.",
      },
      {
        heading: "Compare insider activity with public market calls",
        body:
          "A ticker with unusual insider buying and a cluster of public bullish calls may deserve a different review than a ticker with heavy selling and deteriorating sentiment. YouAnalyst helps put those signals side by side.",
      },
      {
        heading: "Use daily pages for discovery",
        body:
          "Daily insider pages give you a starting point for finding companies with new insider activity. From there, ticker pages and prediction pages can help you decide whether the signal fits a broader thesis.",
      },
    ],
    faqs: [
      {
        question: "Does insider buying mean a stock will go up?",
        answer:
          "No. Insider buying can be informative, but it is not a guarantee. It should be combined with valuation, fundamentals, market conditions, and other research.",
      },
      {
        question: "Why do insiders sell stock?",
        answer:
          "Insiders may sell for many reasons, including diversification, taxes, planned sales, compensation, or personal liquidity. Context matters.",
      },
      {
        question: "Where can I find insider activity on YouAnalyst?",
        answer:
          "Use the daily insider transaction pages for discovery, or search a ticker to inspect insider activity in company context when data is available.",
      },
    ],
    relatedLinks: [
      {
        href: "/daily/insiders",
        label: "Daily insider transactions",
        description: "Find recently surfaced insider buying and selling activity.",
      },
      {
        href: "/predictions",
        label: "Prediction feed",
        description: "Compare insider signals with public stock calls.",
      },
      {
        href: "/companies",
        label: "Ticker research",
        description: "Search companies and connect insider activity with other research signals.",
      },
    ],
  },
];

export function findResearchPage(slug: string): ResearchPage | undefined {
  return researchPages.find((page) => page.slug === slug);
}
