export type FeaturedCompany = {
  symbol: string;
  name: string;
  sector: string;
  thesis: string;
  relationships: string[];
};

export const featuredCompanies: FeaturedCompany[] = [
  {
    symbol: "MSFT",
    name: "Microsoft",
    sector: "Technology",
    thesis:
      "Cloud infrastructure, enterprise software, and AI distribution make Microsoft a central node for technology cash-flow and ecosystem analysis.",
    relationships: ["cloud partner", "enterprise stack", "AI platform"],
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    sector: "Technology",
    thesis:
      "NVIDIA sits at a high-leverage point in the AI compute chain, linking hyperscalers, semiconductor manufacturing, and model deployment demand.",
    relationships: ["chip supply", "AI compute", "hyperscaler demand"],
  },
  {
    symbol: "AMZN",
    name: "Amazon",
    sector: "Consumer",
    thesis:
      "Amazon connects retail demand signals, logistics infrastructure, and cloud economics, which makes it valuable as a multi-cluster bridge node.",
    relationships: ["retail demand", "logistics", "cloud services"],
  },
  {
    symbol: "LLY",
    name: "Eli Lilly",
    sector: "Healthcare",
    thesis:
      "Eli Lilly is a strong healthcare graph node for obesity therapeutics, supply-chain constraints, and competitive therapy category mapping.",
    relationships: ["drug pipeline", "therapy competition", "manufacturing scale"],
  },
  {
    symbol: "AAPL",
    name: "Apple",
    sector: "Technology",
    thesis:
      "Apple anchors consumer hardware, services revenue, supply-chain exposure, and device ecosystem demand signals.",
    relationships: ["consumer devices", "services ecosystem", "supply chain"],
  },
  {
    symbol: "GOOGL",
    name: "Alphabet",
    sector: "Technology",
    thesis:
      "Alphabet connects search advertising, cloud infrastructure, AI product distribution, and digital media demand.",
    relationships: ["search ads", "cloud services", "AI distribution"],
  },
  {
    symbol: "META",
    name: "Meta",
    sector: "Communication Services",
    thesis:
      "Meta is a strong signal for social advertising, AI infrastructure spending, and consumer engagement trends.",
    relationships: ["social ads", "AI infrastructure", "consumer engagement"],
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    sector: "Consumer",
    thesis:
      "Tesla links EV demand, battery supply chains, autonomous driving expectations, and manufacturing scale questions.",
    relationships: ["EV demand", "battery supply", "autonomy"],
  },
  {
    symbol: "AVGO",
    name: "Broadcom",
    sector: "Technology",
    thesis:
      "Broadcom bridges AI networking, custom silicon demand, enterprise software, and semiconductor cycle analysis.",
    relationships: ["AI networking", "custom silicon", "enterprise software"],
  },
  {
    symbol: "JPM",
    name: "JPMorgan",
    sector: "Financials",
    thesis:
      "JPMorgan is a central financial node for credit, rates, consumer banking, and capital markets activity.",
    relationships: ["credit cycle", "rates", "capital markets"],
  },
  {
    symbol: "V",
    name: "Visa",
    sector: "Financials",
    thesis:
      "Visa connects consumer spending, cross-border travel, payment volumes, and financial network economics.",
    relationships: ["payments", "consumer spending", "cross-border volume"],
  },
  {
    symbol: "UNH",
    name: "UnitedHealth",
    sector: "Healthcare",
    thesis:
      "UnitedHealth is useful for managed care margins, healthcare utilization, policy risk, and provider economics.",
    relationships: ["managed care", "healthcare utilization", "policy risk"],
  },
  {
    symbol: "COST",
    name: "Costco",
    sector: "Consumer",
    thesis:
      "Costco highlights resilient retail traffic, membership economics, grocery inflation, and consumer trade-down behavior.",
    relationships: ["membership retail", "grocery inflation", "consumer traffic"],
  },
  {
    symbol: "XOM",
    name: "Exxon Mobil",
    sector: "Energy",
    thesis:
      "Exxon Mobil ties oil prices, refining margins, capital discipline, and global energy demand into one signal.",
    relationships: ["oil prices", "refining", "energy demand"],
  },
  {
    symbol: "CAT",
    name: "Caterpillar",
    sector: "Industrials",
    thesis:
      "Caterpillar tracks infrastructure spending, mining activity, construction demand, and industrial cycle strength.",
    relationships: ["infrastructure", "mining", "construction"],
  },
  {
    symbol: "AMD",
    name: "AMD",
    sector: "Technology",
    thesis:
      "AMD is a clean read on CPU and accelerator competition, datacenter demand, and PC cycle recovery.",
    relationships: ["AI accelerators", "datacenter", "PC cycle"],
  },
  {
    symbol: "PLTR",
    name: "Palantir",
    sector: "Technology",
    thesis:
      "Palantir links government software, enterprise AI adoption, and high-growth valuation debates.",
    relationships: ["government software", "enterprise AI", "analytics platforms"],
  },
  {
    symbol: "NVO",
    name: "Novo Nordisk",
    sector: "Healthcare",
    thesis:
      "Novo Nordisk is a high-signal node for obesity therapeutics, diabetes care, supply constraints, and global healthcare demand.",
    relationships: ["obesity therapeutics", "diabetes care", "drug supply"],
  },
  {
    symbol: "HD",
    name: "Home Depot",
    sector: "Consumer",
    thesis:
      "Home Depot helps read housing turnover, repair and remodel demand, contractor activity, and consumer durability.",
    relationships: ["housing", "remodel demand", "contractors"],
  },
  {
    symbol: "GE",
    name: "GE Aerospace",
    sector: "Industrials",
    thesis:
      "GE Aerospace connects commercial aviation demand, engine services, defense exposure, and supply-chain throughput.",
    relationships: ["aviation", "engine services", "defense"],
  },
];

export function randomFeaturedCompanies(count = 4): FeaturedCompany[] {
  const pool = [...featuredCompanies];

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}
