# Incremental seven-day feed cache

The shared cache starts with the current New York calendar day. A `before`
cursor opens only the immediately preceding day; replaying the same cursor is
idempotent. Once one visitor loads a day, other visitors and industry themes
reuse it. The maximum is today plus six earlier calendar days.

There is no time-based expiry of source data. At the first request after the
New York day boundary, the cache adds today and removes partitions outside the
seven-day window, including their stored chunks. With no traffic, cleanup waits
for the next access; original source records are never deleted. DST boundaries
use New York calendar dates rather than fixed 24-hour buckets.

## Persistence and updates

The existing server-only `collectors` collection contains `_feed_cache_v1`
(manifest and short-lived update lease), compressed chunk documents prefixed
`_feed_cache_v1_`, and `_feed_revision_v1` (change notification). No new
collection or external cache service is required. Compressed payloads are
excluded from indexing. Chunks are bounded below Firestore's document limit;
manifest publication, chunk writes, and old-chunk removal are atomic.

News/disclosure ingestion, SEC discovery, headline translations, classification,
and calendar enrichment call `markFeedChanged` in the same transaction as the
source mutation. This writes a server commit timestamp to the source and to the
revision document. The next reader synchronizes only records changed after the
last successful checkpoint, adding or replacing records in loaded days. A late
arrival for an unloaded day stays in source storage until that day is requested.
Failed cache writes do not advance the checkpoint, so the next request retries.
All future writers of public feed data must use the same transactional marker.
Direct console edits bypass that contract and need an explicit cache repair.

Each request checks small metadata documents. An unchanged feed does not query
the historical source collections or rewrite cache chunks. Cached feed data
survives server restarts; missing/corrupt partitions can be rebuilt individually.
Projection/price metadata can refresh every five minutes from cached source
records, without expiring those records. Browser polling uses conditional ETags
to avoid downloading the same response repeatedly.

## UI

The period is labeled **Last 7 days**. The list initially shows ten entries;
**Show 10 more** reveals additional items already loaded. **Load previous day**
loads one older day. The loaded date range and partial-week totals are explicit;
an empty day still counts as loaded. The API retains all entries in loaded days
so pagination does not silently discard entries beyond the old 200-item cap.

## Rollout

1. Apply `firestore.indexes.json`, including the SEC date-only query index, and
   wait for it to be ready.
2. Deploy all updated ingestion/enrichment workers before or alongside the web
   service. Old workers do not produce change markers and must not continue
   writing unnoticed after the cache is enabled.
3. Deploy the web service. The first request creates only today's partition.
4. Compare actual daily document reads and writes after rollout. Local tests
   validate behavior, not production cost attribution or live IAM/index access.

No deployment or production database mutation was performed while implementing
this change. Changes are on `codex/incremental-feed-cache`.
