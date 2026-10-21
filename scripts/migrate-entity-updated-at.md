# Entity timestamp migration

`updatedAt` is the Firestore server commit timestamp for company, fundamentals,
instruments, and relationship document writes. It is not a filing date or financial as-of date.
No new fields or collections are introduced.

Rollout order:

1. Deploy the additive index configuration and wait for readiness. Legacy
   `cacheUpdatedAt` composite indexes remain during revision overlap.
2. Deploy the updated writers to every website and worker consumer. Confirm old
   revisions and in-flight jobs have drained. Do not enable an incremental-file
   consumer against partially migrated documents.
3. With `GCP_PROJECT_ID` set, run
   `npx tsx scripts/migrate-entity-updated-at.ts --collection=companies`.
   Dry-run is the default. Repeat for `company_fundamentals`,
   `company_relationships`, `instruments`, and `collectors` (only deletion tombstones qualify).
4. Add `--apply --compatible-revision=<live-revision>` to apply one page.
   The default page has 100 documents; `--limit=3000` is the maximum. Writes use
   batches of 50 with a one-second delay. Website health and monitoring run before
   and after each invocation and at most once a minute during it. Monitoring uses
   the target project's quota. Stop on capacity issues or unavailable monitoring.
   Resume using the emitted `--after=<document-id>` only
   after a successful page. On failure, rerun the same page; the operation is
   idempotent. Concurrent changes cause a precondition failure rather than a
   lost update.
5. Repeat a dry-run from the beginning to verify no records need conversion.
   Start new incremental consumers from a fresh full snapshot and watermark.
   Retire the legacy indexes in a later deployment after verification.

The migration stamps modified documents at commit time and deletes
`cacheUpdatedAt`. It deliberately does not preserve a stale watermark that
could hide a migration from active incremental readers. Unchanged records with
a valid Timestamp and no legacy field are skipped. This script has not been run
against production as part of the local implementation.
