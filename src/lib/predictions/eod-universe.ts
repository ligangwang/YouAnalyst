import { loadCollectionUniverse } from "../company-themes/service";
import { usMapTickers } from "../knowledge-graph/us-companies";
import { cnMapCompanies } from "../knowledge-graph/cn-companies";
import { predictionInstrument, type PredictionMarket } from "./instrument";
import { TRACK_RECORD_BENCHMARK } from "./track-record";

export async function loadEodPriceUniverse(input: {
  market: PredictionMarket; loadPrices: boolean; manualTickers: string[]; predictionTickers: string[];
}, loadGraph = loadCollectionUniverse) {
  const base = input.manualTickers.length ? input.manualTickers : input.predictionTickers;
  let mapTickers: string[] = [];
  // Explicit manual repairs keep their requested scope. Every ordinary price run
  // includes the market's full live map, independently of prediction pagination
  // (A-share market caps are calculated from these stored closes).
  if (input.loadPrices && !input.manualTickers.length) {
    const graph = await loadGraph();
    mapTickers = input.market === "US" ? usMapTickers(graph) : cnMapCompanies(graph);
    if (!mapTickers.length) throw new Error(`No ${input.market} map companies found; refusing to skip EOD map coverage`);
    const invalid = mapTickers.filter(ticker => predictionInstrument(ticker)?.market !== input.market);
    if (invalid.length) throw new Error(`Unsupported ${input.market} map price symbols: ${invalid.join(", ")}`);
  }
  // Ordinary US runs also price the track-record benchmark; it is not a map company, so it stays out of map coverage.
  const benchmarkTickers = input.market === "US" && mapTickers.length ? [TRACK_RECORD_BENCHMARK] : [];
  return { requestedTickers: [...new Set([...base, ...mapTickers, ...benchmarkTickers].map(t => t.trim().toUpperCase()).filter(Boolean))].sort(), mapTickers, benchmarkTickers };
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
