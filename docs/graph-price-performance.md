# Graph price performance

The intelligence workspace displays daily closing-price changes for supported US
and mainland-China listings in every theme. It reads the existing historical GCS
cache and `eod_prices` documents; page views never call a price provider or write
market data. Company reads are shared across themes for five minutes.

Daily change compares the two latest available trading sessions. The tooltip
includes both dates, so holidays and delayed quotes are visible. Event returns
compare the last completed close before the source publication timestamp with
the latest available close. Date-only publications use the previous trading day;
after-close announcements use that day's close. Planned events, missing baselines
and announcements without a subsequent completed close have no percentage.

These are **unadjusted closing-price changes**, excluding dividends and split
adjustments, not total investment returns or attribution of a price move to news.
The original history cache supplies raw closes for legacy documents that used
adjusted closes. New EODHD daily writes retain `rawClose` separately, preserving
existing prediction scoring. Legacy adjusted-only values are never mixed into
the graph's price series. Unsupported/private companies remain without quotes.

The web runtime needs object-viewer access to `EODHD_BULK_EOD_BUCKET`. Cache
failures omit unavailable values without disrupting the source feed. No new
Firestore collection or composite index is required.
