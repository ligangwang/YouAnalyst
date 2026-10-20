# Calendar pending-work queue

Routine calendar collection queries `events.calendarNextCheckAtMs <= now`,
ordered by that field, with a 300-document limit. It no longer scans recent
news or cycles through event history. The existing automatic single-field
ascending index supports this query; verify that the field has no index exemption
before deploying the consumer.

News and disclosure ingestion enqueue eligible IR/exchange announcements at
time zero. Completed recent articles and sources with future schedules remain
due daily, preserving checks for changes to the original article. Other completed
sources stop being due. Fetch failures retain their existing backoff. Receipt
identity, request fencing, and usage accounting still prevent a repeated paid
request for unchanged content.

Changed content creates a new receipt. Persistence includes the previous receipt's
schedule associations so removed schedules are retired; independently supported
schedules and later cancellations retain the existing precedence rules.

## Historical migration and rollout

Run `npx tsx scripts/backfill-calendar-queue.ts` for a dry run. Use `--apply`
to seed existing candidates, and `--after=<last-document-id>` to resume.
Each invocation scans at most 500 documents and throttles writes. Repeat until
the reported `complete` flag is true. This only seeds queue fields: it does not
fetch articles or make model requests. Existing next-check times and already
queued work are preserved. Monitor errors and listener load during writes.

Deploy queue-producing ingestion first, complete and verify the migration, then
enable the pending-only calendar consumer. Keep the existing service serving
during rollout. Do not silently fall back to full history scans.

Cached-response revalidation remains the explicit `--revalidate-calendar`
operation. Its separate receipt cursor does not affect normal queue processing.
For an explicit source edit/repair, enqueue the source with
`calendarNextCheckAtMs: 0` and `calendarExtraction.nextCheckAtMs: 0`.
Changing a queue flag alone does not authorize retrying an uncertain paid request.

## Article-analysis queue

Routine article analysis now reads only `newsAnalysisNextCheckAtMs <= now`,
ordered by that single indexed field, with a 200-document bound. IR news ingestion
queues new articles; terminal analyses and uncertain paid requests stop being
selected. Fetch failures retain their daily backoff. Transactional receipt claims,
monthly budget reservations, ownership checks, and duplicate usage prevention
remain authoritative.

Use `npx tsx scripts/backfill-news-analysis-queue.ts` (dry run by default),
`--apply`, and `--after=<last-document-id>` to seed historical IR news explicitly.
The same producer-first, bounded migration and verification requirements apply.
This script does not call a provider or reset existing queue state. Historical
receipts without a source marker may be read once to retire their queue entry;
they cannot cause another paid request. Existing completed analyses are not
automatically rerun when an extractor version changes.
