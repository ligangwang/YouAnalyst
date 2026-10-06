# Mapped-stock daily price history

The initial history starts at 2025-12-31. The existing `eod_prices` collection stores raw daily OHLC prices plus a separate `adjustedClose` from EODHD. Existing documents, current-price summaries and prediction scores are preserved.

Each stock uses one historical EOD request for its full range. Raw responses are cached in the existing EOD bucket before price writes. A per-stock checkpoint and lease in the existing `collectors` collection prevents repeat downloads, concurrent work and duplicate theme enrollment. Failed writes resume from cache; failed stocks retry after 24 hours. Private or unsupported-market companies have no rows and are excluded from the backfill plan.

Normal EOD runs detect stocks without a completed history checkpoint and process at most five per run. Newly enrolled companies therefore get historical data on a subsequent scheduled price run, rather than during enrollment. Manual price repairs, dry runs and prediction roll-forward do not start backfills. Routine daily collection continues to maintain later dates.

For an initial backfill, run `npx tsx scripts/backfill-mapped-price-history.ts` to review the live registry scope. Add `--write` to fetch and fill missing prices. Required configuration: `GCP_PROJECT_ID`, ADC (or a captured `GOOGLE_OAUTH_ACCESS_TOKEN`), and for writes the existing `EODHD_API_TOKEN` and `EODHD_BULK_EOD_BUCKET`. Credentials must stay in the process environment and never be printed. A plan performs database reads only. The command reports excluded companies, requests, created/existing rows and failures.

The end date is market-local, with a conservative 18:00 publication cutoff. Provider trading dates remain authoritative; weekends, holidays, suspensions and pre-listing days are not fabricated. Adjusted closes reflect splits and dividends as of the fetch and should be refreshed as a full series before using them for later total-return analysis.
