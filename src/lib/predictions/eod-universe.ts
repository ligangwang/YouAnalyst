import { loadKnowledgeGraph } from "../knowledge-graph/service";
import { usMapTickers } from "../knowledge-graph/us-companies";
import { predictionInstrument, type PredictionMarket } from "./instrument";

export async function loadEodPriceUniverse(input: {
  market: PredictionMarket; loadPrices: boolean; manualTickers: string[]; predictionTickers: string[];
}, loadGraph = loadKnowledgeGraph) {
  const base = input.manualTickers.length ? input.manualTickers : input.predictionTickers;
  let mapTickers: string[] = [];
  // Explicit manual repairs keep their requested scope. Every ordinary US price
  // run includes the full live map, independently of prediction pagination.
  if (input.market === "US" && input.loadPrices && !input.manualTickers.length) {
    mapTickers = usMapTickers(await loadGraph());
    if (!mapTickers.length) throw new Error("No US map companies found; refusing to skip EOD map coverage");
    const invalid = mapTickers.filter(ticker => predictionInstrument(ticker)?.market !== "US");
    if (invalid.length) throw new Error(`Unsupported US map price symbols: ${invalid.join(", ")}`);
  }
  return { requestedTickers: [...new Set([...base, ...mapTickers].map(t => t.trim().toUpperCase()).filter(Boolean))].sort(), mapTickers };
}

type DatedPrice = { ticker: string; market: string; tradingDate: string; close: number };
export function isPriceForEodDate(price: DatedPrice, ticker: string, date: string) {
  return price.ticker === ticker && price.market === predictionInstrument(ticker)?.market
    && price.tradingDate === date && Number.isFinite(price.close) && price.close > 0;
}

export function mapEodCoverage(tickers: string[], runDate: string, prices: Map<string, DatedPrice>, cachedTickers: Set<string>) {
  const available = tickers.filter(ticker => {
    const price = prices.get(ticker);
    return price && isPriceForEodDate(price, ticker, runDate);
  });
  const cached = available.filter(ticker => cachedTickers.has(ticker)).length;
  const found = new Set(available);
  return { runDate, requested: tickers.length, cached, fetched: available.length - cached, missing: tickers.filter(ticker => !found.has(ticker)) };
}
