# Daily entity files

The maintenance image includes `dist/sync-entity-snapshots.cjs`. Deploy with
`scripts/deploy-entity-snapshots.sh` using the built `FUNDAMENTALS_IMAGE` digest,
`GCP_PROJECT_ID`, and an existing private `ENTITY_SNAPSHOT_BUCKET`. Complete and
verify `migrate-entity-updated-at.md` first, then set
`ENTITY_TIMESTAMP_MIGRATION_COMPLETE=1`. No deployment or data migration is
performed by writing this code.

The script registers `sync-entity-snapshots-production`, daily at 03:00
America/New_York, one task, no automatic execution retries. It is a scheduled
Cloud Run job, not an always-on service. Failure logs remain in Cloud Logging;
the existing file remains usable and the next run resumes from its watermark.

Private output objects:

- `entity-snapshots/companies.json`
- `entity-snapshots/instruments.json`
- `entity-snapshots/company_fundamentals.json`
- `entity-snapshots/company_relationships.json`

Each file contains a complete active collection snapshot and its watermark.
The existing `central-cache/codec` tagged JSON format preserves Timestamp
seconds/nanoseconds, binary values, and nested types; consumers must use its
`decode` function. Do not expose these full internal snapshots publicly.
Readers need storage object-viewer access on the bucket. Website/sitemap
consumption is a separate integration; this job alone does not change page reads.

The first run loads all non-operational documents. Subsequent runs query indexed
`updatedAt` inclusively through a Firestore read-time boundary, in pages of 250.
Soft-deleted rows are removed from the file, and restored rows are added again.
No deletion journal, new collection, or shared checkpoint is used. Each file
is replaced atomically with a generation precondition. Overlapping runs cannot
overwrite a newer file. The four files publish independently, not as a single
cross-collection transaction.

Entity lifecycle is enforced by the shared Firestore wrapper. Use
`mutateEntity(db, path, patch, 'edit' | 'delete' | 'restore')` or a transaction.
Logical delete retains the document and updates `updatedAt`. The first later
edit copies the prior `updatedAt` into `deletedAt`; later edits preserve it.
Restore clears `deletedAt`. Direct entity mutations are transactional;
transactions reuse documents already read and fetch any missing write targets.
Combine changes to each entity into one write per transaction. Blind write
batches for these entities are rejected; operational underscore IDs and other
collections retain their existing behavior. Raw SDK/admin-console changes
can bypass application rules and must follow the same policy.

Soft deletion retains final documents, not all historical versions. Complete
timeline playback and version history are not implemented by this job.

Before publishing the instruments file, the job compares company-derived instrument identity against the previous instrument file in memory. Only changed entries are transactionally synchronized; unchanged entries cause no extra Firestore lookup. The initial run reads existing instruments into a file first. Legacy company aliases and provider history keys remain available during the gradual consumer cutover.


## Bounded, resumable price sync

Prices use `price-snapshots/<market>/<ticker>/<year>.sqlite`, independently of
entity snapshots. `PRICE_TIMESTAMP_MIGRATION_COMPLETE=1` enables this phase.
The defaults are 50,000 price document reads, 500 partition publications, and
20 minutes per invocation. Configure `PRICE_SYNC_MAX_READS`,
`PRICE_SYNC_MAX_PARTITIONS`, and `PRICE_SYNC_MAX_DURATION_MS` on the job.
The read cap includes empty queries and operational documents. The single
company boundary lookup and index-entry billing are outside this price-document
budget. The runtime deadline is checked between operations; the Cloud Run task
retains its hard 30-minute limit. Keep that hard timeout below the 35-minute lease.

`price-snapshots/progress.json` stores a fixed scan boundary, the timestamp/ID
cursor (including timestamp nanoseconds), page count, and publication progress.
Compressed pages under `price-snapshots/staging/<scan-id>/` are saved before the
cursor advances. On restart an already uploaded page is reused even if its cursor
save failed. Only the in-flight page can need rereading if killed before upload.
No Firestore collection or document fields are added.

A partial scan does not publish any price partitions or advance the completed
`price-snapshots/checkpoint.json` watermark. After scanning finishes, complete
changed ticker/year partitions publish conditionally, one at a time. Publication
can span runs and resumes using saved pages without Firestore rereads. The global
watermark advances only after all partitions publish. Cleanup is resumable too;
staged pages are deleted after completion. The previous complete partition stays
available until its replacement is ready. Partitions publish independently, not
as one cross-partition transaction.

A generation-checked lease prevents overlapping workers from spending the same
read budget. Clean exits release it; killed executions expire after 35 minutes.
Logs report `status: partial`, `complete`, or `busy`, and per-invocation `reads`,
`changed`, and `partitions`. Partial is successful saved progress, not a failure.
Invalid storage or missing journal pages fail closed rather than restart a scan.

The existing daily schedule is unchanged. A large backlog now takes multiple
bounded executions: 3.5 million documents need about 70 scanning runs at the
50,000 default, plus publication runs. Operators can execute additional runs
sequentially or tune the budget/cadence after observing usage; this change does
not automatically launch catch-up runs. Do not run an older unbounded image
concurrently or roll back to it while saved progress is pending.


## Dedicated price job

`sync-price-snapshots-production` runs `dist/sync-price-snapshots.cjs` from the
Node-only `Dockerfile.price-sync` image. Build with `cloudbuild.price-sync.yaml`
and deploy the immutable digest with `scripts/deploy-price-snapshots.sh`.
Entity maintenance uses `--entities-only`; an older entity image can be isolated
by setting its `PRICE_TIMESTAMP_MIGRATION_COMPLETE=0` until its next release.
This leaves the entity schedule and instrument dispatch running normally.

The dedicated job shares the existing price checkpoint, page journal, and lease.
Default scheduled operation retains 50,000 reads, 500 publications, and a
20-minute soft deadline. `PRICE_SYNC_PAGE_SIZE` accepts 1–1,000 (the dedicated
job uses 1,000); `PRICE_SYNC_PUBLISH_CONCURRENCY` accepts 1–8 (the dedicated job
uses 4). Neither setting increases the per-execution read budget.

After scanning, an immutable `staging/<scan-id>/changes.sqlite` index groups the
saved pages once. Later publishing runs download this index instead of fetching
and decoding all pages again. A failed concurrent publication batch waits for
all uploads before releasing the lease and retries that batch idempotently.
The index is removed with the journal after checkpoint publication.

For an explicitly approved backlog catch-up, execute the dedicated job
sequentially with execution-only overrides such as `PRICE_SYNC_MAX_READS=500000`
and `PRICE_SYNC_MAX_PARTITIONS=10000`. Do not change the saved routine limit.
Check each successful execution, the saved scan ID/cursor, and phase logs before
starting the next. Stop when the fixed scan's completed checkpoint is published;
then run one normal bounded pass to capture later changes. Never reset the
checkpoint or delete pending progress to force a restart.
