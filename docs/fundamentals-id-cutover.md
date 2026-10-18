# Fundamentals ID cutover

Company documents in `company_fundamentals` now use the same IDs as `companies`:
`US:NVDA`, `XSHG:688041`, etc. US provider arguments and existing Pub/Sub version-1
messages still use raw tickers. Operational document IDs remain unchanged.

Both scheduled fundamentals jobs select published companies directly with the
supported themeIds query, then filter by listing market. They no longer load the
graph, relationships, or graph valuations to build their scope. US scheduled
market-cap updates also use this selected list rather than scanning fundamentals.
The US worker still drains previously queued explicit requests, including those
outside scheduled theme coverage; this preserves already-requested work.

These local changes require a coordinated data migration before production rollout.
Do not deploy the new readers against unmigrated data: they deliberately do not
fall back to raw ticker documents or double-read both keys.

1. Export/backup the existing collection. Set `GCP_PROJECT_ID` explicitly.
2. Preview with `npx tsx scripts/migrate-fundamentals-ids.ts`. This performs reads
   but no writes. Resolve any conflicting source/target pairs before proceeding.
3. During a maintenance window stop legacy web traffic (page reads can enqueue
   writes), scheduled jobs, running executions, and Pub/Sub subscriber deliveries
   that write fundamentals or SEC collector checkpoints. A worker lease alone
   does not stop all these writers. Keep them paused through verification.
4. Run `npx tsx scripts/migrate-fundamentals-ids.ts --apply --writers-paused`.
   This flag is an operator acknowledgement, not an automatic pause mechanism.
   The script copies entire documents transactionally, including SEC checkpoints,
   and preserves Firestore field types. It never overwrites a differing target,
   deletes a source, or creates a new collection. A failure can leave a partial
   copy; resolve conflicts and rerun while writers remain paused.
5. Rerun the preview: all existing legacy records must report `identical`.
   Deploy every affected reader and writer, verify canonical reads and writes,
   then resume traffic/jobs/deliveries. Retained legacy pending records are ignored
   by the new US workers. Remove legacy copies only as a separate reviewed cleanup.

After new writers resume, legacy copies become stale. Rolling back to old code
requires stopping writers and reconciling canonical changes back to legacy keys;
simply switching revisions would lose checkpoint continuity.

The standalone full market-cap refresh now pages only the `US:` document-ID range. This excludes
operational receipts and CN records from that scan; it still reads each US company
once per refresh. It does not eliminate all periodic reads or quantify project-wide
savings. US pending-work queries also use the canonical ID range, so retained legacy copies
do not inflate the queue or its remaining-work count.
