# Bounded live earnings pilot

The live path is separate from the offline replay described in
[earnings-pilot.md](earnings-pilot.md). It is **off by default** and supports only
NVIDIA, AMD, Microsoft, Alibaba ADR, SMIC, Longsys, Cambricon and Zhongji Innolight.
This document describes the implementation and its rollout procedure; a code
merge alone is not evidence that collection has been activated.

## Verified source coverage

On 2026-10-02, current full SEC earnings exhibits for all four US-listed issuers
and nine original mainland PDFs were validated against independently reviewed
facts. The US corpus additionally includes prior-period and issuer-IR versions;
see the `tests/fixtures/earnings/live-us` and `live-cn` provenance manifests for
exact document counts, byte hashes and scope. Original publisher documents are
not committed to the repository.

- US: reviewed quarterly consolidated revenue and reported growth tables;
  native USD for NVIDIA/AMD/Microsoft and RMB for Alibaba. Source fiscal dates
  and table columns determine the period. No annual-to-quarter relabelling.
- Mainland: reviewed Q1 and cumulative H1 accounting tables, plus the reviewed
  Longsys-style revenue forecast range. H1 remains January–June, never Q2.
- Unsupported segments, US guidance, Q3/annual mainland layouts, summaries,
  changed/recast table shapes, scanned PDFs and ambiguous evidence do not produce
  guessed metrics. Relevant sources remain `review_required`; clearly unrelated
  SEC exhibits are `skipped`. Preliminary coverage is synthetic only.
- New correction notices/amended filings require an explicit predecessor before
  normalized promotion. Same-URL content changes retain immutable raw captures
  and normalized revisions. Neither duplicates nor corrections erase history.

Public CNINFO JSON and PDFs were accessible without login or CAPTCHA. This is a
technical-access observation, not a commercial data licence. Use remains bounded
to official public disclosures, private provenance storage and extracted facts.
403/429 responses stop requests and persist cooldowns; no login, CAPTCHA bypass,
paid subscription or HKEX scraper is introduced.

## Discovery, delivery and storage

US discovery is a pre-filter observer in the **existing SEC collector job**, using
its existing shared HTTP budget and lease. The four pilot CIKs receive a bounded
priority pass; the same source instance caches each response for the existing
financial-form scan. There is no second scheduled US poller. Observer/metadata
failures do not suppress valid annual-fundamentals discovery. The strict
`sec.filing.discovered` contract and graph/Flex budget controls are unchanged.

The earnings job runs every 15 minutes, polls each mainland issuer at most hourly,
and drains the durable intake outbox. First scans and daily reconciliation cover
180 days; other scans overlap the last completed checkpoint by seven days. A
partial page, archive budget, provider failure or persistence failure does not
advance that issuer's checkpoint. China filters use the Shanghai calendar day.

`earnings.source.discovered` contains only a stable source ID and generation.
The authenticated subscriber loads its durable source, retrieves an actual SEC
filing index and EX-99 exhibits or a CNINFO PDF, validates the document, resolves a
reviewed deterministic adapter, and atomically records the validated revision and
source checkpoint before acknowledging delivery. No model API is called.

Exact server-only Firestore destinations:

| Collection | Purpose |
| --- | --- |
| `earnings_sources` | Source work/outbox, immutable capture manifests, compressed raw byte/text chunks |
| `earnings_records` | Immutable validated revisions and event-head/correction links |
| `earnings_collectors` | Cursors, leases, cooldowns, delivery probes, canary proof and run diagnostics |

Raw documents are limited to 20 MiB. Compressed data is split into 400,000-byte
chunks; raw and text hashes, chunk hashes/order, restored lengths and bounded
decompression are checked independently. Normalized records carry evidence spans,
URLs, native units, accounting basis, actual/forecast type, fiscal period and
date precision. Filing acceptance, source publication, announcement date and
collection time remain separate. No UTC publication instant is invented from a
date-only disclosure.

Publication is at least once. A source/generation has a deterministic delivery
ID, uncertain publications remain recoverable, and consumers reject stale work.
Each source has a ten-minute processing lease and at most five failed processing
attempts before manual review. New source generations can recheck content without
duplicating unchanged normalized revisions. Failed writes cannot acknowledge an
uncommitted result.

CNINFO discovery and document downloads share a durable earnings-specific gate
and cooldown across earnings replicas. The legacy fundamentals requester retains
its separate local limit; this implementation does not claim a provider-wide
account quota. SEC requests use the existing application-wide SEC gate.

## Approved deployment boundary

The implementation uses these names in `ifindata-80905`, `us-central1`:

- Topic `earnings-sources-discovered`, push subscription `earnings-worker`
- Dead-letter topic `earnings-dead-letter`, retained subscription
  `earnings-dead-letter-audit`
- Private service `earnings-subscriber`
- Job and scheduler `collect-earnings-production`

Setup uses the existing `directory-sync-runtime` and `directory-sync-scheduler`
service accounts and existing Pub/Sub service agent. Only five new resource
bindings are permitted: runtime publishes to the earnings topic; scheduler invokes
the earnings service/job; Pub/Sub publishes to the earnings dead-letter topic and
subscribes to the earnings worker subscription. There are no new accounts,
credentials, project-wide grants, service-account IAM changes, storage buckets or
web-app access grants. Setup requires the user's explicit approval of these
resources, bindings and collection names. Ordinary releases only check existing
earnings resources/IAM before deployment.

## Rollout and verification

Serialize this sequence against other main-branch production releases:

1. Keep production `EARNINGS_PIPELINE_ENABLED`, `EARNINGS_COLLECTION_ENABLED` and
   `EARNINGS_PROCESSING_ENABLED` absent or `0` for the initial code release. Wait
   for the exact main revision's complete production release to pass.
2. Run the approved `setup-paused` action of **Set up paused earnings pipeline** for that
   exact SHA. It creates the approved resources, disables processing/collection,
   verifies a paused scheduler, and tests first/duplicate Pub/Sub delivery without
   requesting source documents or writing financial records.
3. Run `canary`. It enables only the earnings runtimes with
   `EARNINGS_CANARY_ONLY=1`; the schedule and SEC observer remain disabled. The
   one-off live probe selects AMD's latest Item 2.02 8-K and Longsys's latest
   supported full report. It publishes exactly those intake generations, allows
   at most five derived AMD exhibits, validates both actual records, and restores
   their stored raw provenance. Old/unrelated queued deliveries cannot fetch
   documents during this canary. An incompatible active source fails before
   publication. Failure leaves earnings paused/disabled and invalidates its proof.
4. Inspect the concrete canary records, URLs, fiscal periods and raw hashes. Run
   `activate` only after the current-SHA, less-than-24-hour durable proof passes.
   Activation clears canary-only mode, enables the earnings observer flag on the
   existing SEC collector without changing its other settings, and resumes only
   the earnings schedule. Existing graph/SEC live schedules and Flex cap remain
   unchanged.
5. **Persist and read back all three production GitHub variables as `1`** before
   allowing another ordinary main release. Runtime activation alone does not
   update GitHub configuration. A later release otherwise resets or omits the
   pipeline. `EARNINGS_CANARY_ONLY` has no repository variable and is always `0`
   in normal deployment.
6. Observe real scheduled executions and `diagnostics`: advancing issuer cursors,
   current execution/revision, durable outbox progress, normalized records and
   review reasons. A manual canary alone is not evidence of scheduled collection.
   Report actual supported coverage and any partial/unsupported sources.

The manual workflow prints bounded read-only diagnostics and public financial
record samples directly into its logs using the existing release identity. It
does not require Cloud Console access or print raw documents/provider secrets.
If that identity lacks Firestore read access, stop and report the missing
permission; do not add a grant or impersonate another identity.

Rollback pauses the earnings schedule and resets earnings flags on its job,
subscriber and SEC observer, preserving existing SEC/graph configuration. Persist
and read back `EARNINGS_COLLECTION_ENABLED=0` and
`EARNINGS_PROCESSING_ENABLED=0` in production GitHub variables before another
release. Rollback prevents future work; it does not retry or cancel an uncertain
bounded execution. Previously captured evidence/revisions remain intact.

The manual workflow requires exact current main, the latest successful production
release attempt, and explicit operation approval. Runtime images use immutable
digests. Setup and operations never install or configure AI credentials.

## Local checks

```sh
node --import tsx --test tests/securities/earnings*.test.ts
node --import tsx --test tests/deploy/earnings-deploy.test.ts
EARNINGS_US_SOURCE_DIR=/path/to/verified/raw/files \
  node --import tsx --test tests/securities/earnings-live-us.test.ts
```

The existing `replay-earnings-pilot.ts --dry-run` stays offline. Production
`collect-earnings` defaults to read-only diagnostics; live work requires `--apply`
and the enabled flag. `--verify-delivery` remains provider-free even when runtime
flags are enabled. `--check-canary` only reads durable proof. Ordinary collection
has no unbounded-company or arbitrary-URL CLI option.
