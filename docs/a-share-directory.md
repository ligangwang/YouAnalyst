# A-share directory and research

AI company-profile and industry-relationship research for both US and A-share companies is retired. The old admin pages show a retirement notice and both research APIs return HTTP 410 for reads and writes. No new research, retry, provider-response polling or publication is available through those tools. Existing drafts, usage receipts and published profiles/relationships remain stored; public projections continue to read published records.

Cloud Scheduler still triggers `sync-cni-directory-production` weekly to import the latest official CNI classification snapshot. Run it manually and view its history in `/admin/jobs`. Imports do not invoke OpenAI and no longer enqueue identities in `industry_research_candidates`.

The downloader reads the latest file link from https://www.cnindex.com.cn/zh_information/data_resource/fljg/, validates headers and every supported record, and rejects suspiciously small snapshots. Shanghai 6xxxxx and Shenzhen 0xxxxx/3xxxxx listings are supported. Beijing, Hong Kong and B-shares are excluded. Snapshot dates describe classification coverage, not live listing status. Missing entries do not imply delisting. There is no total company-count limit; paging and transaction sizes are technical bounds only.

`company_directory/{exchange}:{code}` stores company identity, four CNI classification levels, source and snapshot. `industry_research_candidates/{exchange}:{code}` contains historical private queue state and is no longer updated by imports. Repeated imports preserve published profiles and editorial names. `directory_syncs/CN_A_CNI` records the completed snapshot, checksum, count and industries. Partial imports can be replayed; the completion marker advances only after every chunk succeeds. Unchanged files are skipped; older snapshots are rejected.

Published profiles stay in `companies`. Imported identities are never exposed as researched profiles. Imports create directory-only records while preserving existing researched profiles and editorial content. The completed five-company deployment seed script has been removed. CNI classifications are never represented as GICS.

Firestore default deny protects source/queue collections. APIs verify administrator role server-side; the admin layout hides tools until verification. Existing US ticker sync is unchanged.
