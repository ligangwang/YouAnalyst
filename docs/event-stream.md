# Shared public event store

`events/{type}-{accessionNumber}` stores one public SEC filing event per accession.
The first producers are the existing Form 4 and 13F processing workers. They publish
after source processing succeeds; dry runs do not publish. Publication failures
propagate to the existing job retry path. Reprocessing replaces the public facts
but preserves the first `publishedAt` value in a Firestore transaction.

The store contains public source facts only. Private watchlist calls, personal
feed delivery, and read/saved/dismissed state do not belong in this collection.
No client writes or direct database access are introduced. Existing Firestore
default-deny rules apply; the server read API projects only approved fields.

## Read API

`GET /api/events?limit=30` returns `{ items, nextCursor }` in descending publication
order. Limits must be integers from 1 to 50. Pass the opaque `nextCursor` as `cursor`
to retrieve the next page. Publication time plus document ID provides deterministic
ordering for timestamp ties. No composite index is needed for this global query.
Bad input returns 400; storage failure returns 503 without internal error details.
An empty store returns an empty page, not sample data. Writes are server-only.

`occurredAt` is the SEC filing date, with `occurredAtPrecision: "date"`; it is not
an invented filing timestamp or an insider's transaction date. `publishedAt` is when
YouAnalyst first published the event; `updatedAt` records the latest processing.
Amendments have their own accession and event. Events describe processed filings,
not trading recommendations or assertions about current institutional positions.

## Rollout and later consumers

Existing ingestion schedules populate the collection as filings are processed.
There is no automatic historical backfill or new paid data provider. Existing
reprocessing tools can publish older filings using the same deduplication path.

The home page now loads its first page on the server and subscribes to
`GET /api/events/stream` using browser EventSource. The server shares one bounded
Firestore listener across connected viewers on that instance and projects the
same public fields as the read API. It releases the listener when the last viewer
disconnects. Heartbeats keep the connection active; streams rotate after four
minutes and reconnect automatically. Hidden browser tabs disconnect until visible.
No additional database read rules are needed because the listener stays server-side.

New snapshots replace the latest page when the reader is at the top. While reading
or focusing a card, arrivals wait behind a New updates button. Applying updates
returns to the latest page; older pages remain available through cursor pagination.
Repeated snapshots after reconnect do not discard already-loaded history.
The company map is now `/map`; old `/?company=...` links redirect there.

Future work: ticker/type
queries with their corresponding indexes; personalized event references under
`users/{uid}/feed/{eventId}`; and separate per-user event state. Private activity
must stay in access-controlled personal feeds.
