# Company master

`market_companies` is the shared company profile collection for US listings and mainland A-shares. IDs are `US:AMD`, `XSHG:688041`, or `XSHE:300308`; symbols without market context are not document IDs.

Company autocomplete and the A-share directory read this collection. Prediction autocomplete uses the same collection but only includes active, supported US securities. Institutional-manager search remains in `institutional_managers` because those records represent fund managers, not listed companies.

AI graph versions retain research snapshots and relationships. At read time company nodes reference `market_companies` by ID for current names, symbols and descriptions. Graph coverage is a subset of company search, not its universe.

Before the new production reader deploys, `scripts/sync-market-companies.ts --write` merges the existing ticker catalog, CNI directory and graph company profiles into the master. Reviewed A-share profiles are retained. The replay-safe migration writes `directory_syncs/market_companies_v1` only after all batches succeed. No source collections are deleted.

Subsequent ticker synchronization, CNI imports, company research publication and graph imports update the master. `tickers` and `company_directory` remain provider/research inputs, rather than public search sources. Broad company search accepts Chinese text and normalized stock codes. The AI canvas search filters its participating companies only.
