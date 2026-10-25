# SEC bulk financial acquisition

The existing nightly SEC maintenance publisher prepares the official `companyfacts.zip` and `submissions.zip` before queuing company work. This supplements the incremental filing pipeline; it does not replace filing discovery, accession freshness checks, or downloads of reports and exhibits. SEC publishes these financial JSON archives nightly: https://www.sec.gov/search-filings/edgar-application-programming-interfaces.

The producer freezes the interested US company scope and resolves its CIKs through the existing SEC identity map. It streams each archive to the existing private entity-snapshot bucket. Request admission uses the existing global five-request-per-second SEC gate and cooldown policy. The header deadline remains twelve seconds; the whole preparation has a fifteen-minute abort signal. No archive is buffered in container memory.

A bounded random-access ZIP reader caches small header ranges and streams selected entries. Only canonical selected CIK JSON objects are saved. Entry count, decompressed size, issuer identity, CRC, and object generations are checked. ZIP64 is supported. Paths never reach the local filesystem. Both archives must contain every selected CIK before immutable manifest creation and a generation-conditional latest-pointer update. Missing issuer coverage fails preparation and preserves the previous pointer before company work is queued. Failed staging remains invisible; missing selected JSON never triggers a live all-company fallback.

Scheduled company tasks pin the published snapshot for their reads. Published snapshots older than 36 hours fail preflight before company processing. Before the first successful snapshot, and for companies outside its frozen scope, the existing bounded live path remains available for additive rollout. Incremental new-filing tasks and delivery verification explicitly use the live path; document and identity-map requests remain unchanged. No new Firestore collection or field is introduced.

## Retention

The existing SEC download cleanup job also cleans raw bulk data. SEC snapshot objects and EODHD raw exchange JSON expire seven days after object creation. Cleanup uses bounded scans, a thirty-second work budget and at most 100 deletions per prefix per run. Every deletion checks the object's generation and metageneration again.

The latest SEC snapshot and extraction holds are protected. Queued readers consume immutable extracted JSON, not the raw ZIP. Normal completion and failure release extraction holds; a crashed process can leave a hold requiring retry or investigation. Active EOD company pipelines and legacy readers exclude EOD cleanup through the existing coordination leases. Cleanup never targets persisted price history, website SQLite snapshots, or individual filing documents. Individual filing-cache retention remains ninety days. Seven days is a retention window, not the acquisition interval.

Deployment adds the bulk flag to the existing SEC producer and subscriber and grants the existing maintenance identity access to the private snapshot bucket. Schedules, subscriber protection, delivery retries, and live SEC throttling remain in place. Verify the first normal nightly publication and per-company reads after deployment; a successful deployment alone does not prove archive ingestion.
