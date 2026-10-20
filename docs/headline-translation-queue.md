# Pending headline translations

News and exchange-disclosure ingestion writes `headlineTranslationPending` and
`headlineTranslationDate` on the existing event. The worker queries pending events
for enrolled company IDs (groups of 30), ordered by date within the existing
30-day window, with up to 40 results per group and 40 processed per run.

The claim transaction rechecks eligibility and clears pending before a provider
request. Failed or uncertain attempts stay held for review. A changed title needs
`headlineQueueFields(updatedRecord)` written alongside the edit to enqueue its
new translation. A title changed during an in-flight request is requeued by the
worker rather than receiving the old title's translation. Stale pending flags are
cleared when encountered.

Before release, apply the added composite index in `firestore.indexes.json` and
wait for READY. Deploy ingestion and the pending-query worker with the normal
availability-preserving release. Run `scripts/backfill-headline-queue.ts` first in
dry-run, then with `--apply`; pass the last logged `--after=document-id` to resume
until `complete:true`. Each invocation scans at most 500 events, updates one
document per transaction, and throttles updates. Monitor request errors/event
backlog while applying; stop further batches if capacity deteriorates.

The backfill rereads current documents transactionally so it never resets a
concurrent translation claim or completed/review-held attempt. It does not call
the translation provider. It can be rerun safely. After all old ingestion workers
finish, run a final pass to cover events they created without queue fields.
Existing unflagged headlines are not selected until backfilled; ordinary news
display remains available throughout. No new collection is created.
