# A-share directory and research

Three independent operations:

1. `.github/workflows/sync-company-directory.yml` imports the newest official CNI classification snapshot weekly or on manual dispatch. It is independent of website deployment; source outages cannot block releases. Production environment approvals still apply. Dispatch the first import after merging. It does not invoke OpenAI.
2. `/admin/company-research` processes up to five pending identities at a time. Each company has an independent background response, draft, failure and explicit retry. Keep the queue open to refresh results automatically, or return and refresh. Starting new companies is admin initiated in this first version. Each company consumes one of the shared 100 research requests per UTC day; imports and refreshes do not. Inspect provider usage before retrying uncertain startup failures or timeouts.
3. `/admin/industry-research` retains US industry connection research and uses imported CNI industries for A-share connections. Relationships require searched evidence and admin review. Industry membership never creates a relationship. Both markets use `company_relationships` with market-qualified company IDs. Published connections participate in the shared AI map.

The downloader reads the latest file link from https://www.cnindex.com.cn/zh_information/data_resource/fljg/, validates headers and every supported record, and rejects suspiciously small snapshots. Shanghai 6xxxxx and Shenzhen 0xxxxx/3xxxxx listings are supported. Beijing, Hong Kong and B-shares are excluded. Snapshot dates describe classification coverage, not live listing status. Missing entries do not imply delisting. There is no total company-count limit; paging and transaction sizes are technical bounds only.

`company_directory/{exchange}:{code}` stores company identity, four CNI classification levels, source and snapshot. `industry_research_candidates/{exchange}:{code}` holds private queue state. Repeated imports preserve research status, attempts and editorial names. `directory_syncs/CN_A_CNI` records the completed snapshot, checksum, count and industries. Partial imports can be replayed; the completion marker advances only after every chunk succeeds. Unchanged files are skipped; older snapshots are rejected.

Published profiles stay in `companies`. Imported identities are never exposed as researched profiles. Admin approval creates missing profiles while preserving editorial content. The original five-company seed is retained as an explicit initialization tool and does not run during the collection rename. CNI classifications are never represented as GICS.

Firestore default deny protects source/queue collections. APIs verify administrator role server-side; the admin layout hides tools until verification. Existing US ticker sync is unchanged.
