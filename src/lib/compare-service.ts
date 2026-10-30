import {ComparisonCoverageError} from './compare-error';
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { mapTimelinePrice } from "./ui/company-timeline";
import { loadTimelineSplits } from "./ui/corporate-actions";
import { cachedTimelinePrices } from "./ui/timeline-cache";
import { withCacheReadScope } from "./change-cache";
import { predictionInstrument } from "./predictions/instrument";
import { buildComparison, type CompareConfig } from "./compare";

/** Same stored closes, split rules, and change invalidation as the company chart. */
export async function loadStockComparison(db: Firestore, config: CompareConfig) {
  return withCacheReadScope(async () => {
    const histories = await Promise.all(config.symbols.map(async symbol => {
      const instrument = predictionInstrument(symbol)!;
      const data = await cachedTimelinePrices(db, JSON.stringify(["compare", symbol, config.start, config.end]), async () => {
        const { splits } = await loadTimelineSplits(db, instrument.ticker, instrument.market, config.end);
        const prefix = `${instrument.market}_${instrument.ticker}_`;
        const snapshot = await db.collection("eod_prices")
          .where(FieldPath.documentId(), ">=", prefix + config.start)
          .where(FieldPath.documentId(), "<=", prefix + config.end)
          .orderBy(FieldPath.documentId()).limit(6000).get();
        const prices = snapshot.docs.flatMap(doc => {
          const price = mapTimelinePrice(doc.data(), instrument.ticker, instrument.market, splits);
          return price && price.date >= config.start && price.date <= config.end ? [price] : [];
        });
        return { companyId: instrument.companyId, start: config.start, end: config.end, currency: instrument.currency, prices, available: true };
      });
      if (data.prices.length < 2) throw new ComparisonCoverageError(`Not enough stored price history for ${symbol} in this period. Choose another period or remove this stock.`);
      return { symbol, points: data.prices };
    }));
    return buildComparison(histories, config);
  });
}
