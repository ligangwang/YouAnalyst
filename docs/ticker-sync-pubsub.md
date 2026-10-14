# Retired ticker catalog sync

Ticker catalog preview, manual sync, internal sync API, Pub/Sub subscriber, and
deployment target have been removed. No periodic ticker catalog schedule existed.
Existing tickers and companies records, directory sync ledgers, snapshot pages,
request/dead-letter topics and logs are retained.

For existing deployments, delete the ticker-catalog-worker delivery subscription
and ticker-catalog-subscriber Cloud Run service in the production project.
Both were removed from `ifindata-80905` in `us-central1` on 2026-10-14.
Other price, fundamentals, directory, and research jobs continue independently.

The market ticker UI now embeds only the S&P 500, Nasdaq 100 and Dow 30 indices.
The production INDUSTRY_STARTERS list and fixed company/exchange mapping are
removed; graph-model tests supply their own small directory fixtures.
