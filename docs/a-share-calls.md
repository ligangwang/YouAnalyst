# A-share calls

Listed Shanghai and Shenzhen company pages use the shared bullish/bearish and watchlist call controls. Private-company pages omit them, and creation rejects a private company in the canonical `companies` record.

Calls retain qualified ticker IDs (`XSHG:600584`, `XSHE:002837`). US calls retain existing bare symbols. Prices remain in `eod_prices`, calls in `predictions`, and market run status in `eod_runs`; no new collections or data migration are required.

The existing internal `/api/internal/daily-eod-maintenance` endpoint accepts `market: "CN_A"`; omitted market remains `US`. Each market scans only its own calls. China uses the existing EODHD token with `/api/eod/600584.SHG` and `/api/eod/002837.SHE`, requesting an exact date with `from` and `to`. Only actual bars matching that date can open, mark or close calls. Adjusted-close calculation follows the existing US convention. Missing bars (including holidays/suspensions) remain pending, and provider failures never fall back to a US symbol.

When EOD scheduler provisioning is enabled, deployment also provisions a `-cn-a` job at 20:00 and 23:00 Asia/Shanghai on weekdays; the later run retries delayed data. The existing US job is unchanged. Chinese submissions at or after 15:00 target the following calendar date, with actual settlement waiting for an available trading-day bar. CNY price formatting is shared by company calls, watchlist/feed summaries, call details and price charts.

Verification covers exchange-to-provider mapping, currency, Shanghai date boundaries, market-isolated paginated scans, exact-date bars, provider access failures, registration continuation, default-watchlist submission and private-page controls. Tests use isolated mocked requests and do not publish investment calls to production.
