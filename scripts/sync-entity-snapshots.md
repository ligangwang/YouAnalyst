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
