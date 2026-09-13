# Company master

`companies` is the shared company profile collection for US listings and mainland A-shares. IDs are `US:AMD`, `XSHG:688041`, or `XSHE:300308`; symbols without market context are not document IDs.

Company autocomplete and the A-share directory read this collection. Prediction autocomplete uses the same collection but only includes active, supported US securities. Institutional-manager search remains in `institutional_managers` because those records represent fund managers, not listed companies.

The AI map reads published relationships from `company_relationships` and company nodes from `companies`. Graph coverage is a subset of company search, not its universe.

Company initialization and the collection rename are complete. Deployment no longer runs company migration or bootstrap scripts. See the [migration record and recovery export](company-collection-rename.md).

Subsequent ticker synchronization, CNI imports, company research publication and graph imports update the master. `tickers` and `company_directory` remain provider/research inputs, rather than public search sources. Broad company search accepts Chinese text and normalized stock codes. The AI canvas search filters its participating companies only.
