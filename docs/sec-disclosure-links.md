# SEC filing links in the event feed

The existing `collect-sec-filings` job observes the full SEC submissions response
before financial extraction filters it. All valid form types associated with each
mapped US issuer enter the existing universal `events` collection. Company coverage
comes from all published themes. This includes insider and beneficial-ownership
filings associated with the issuer by SEC, even when another entity submitted them.
It does not search every institutional manager's holdings for positions in that issuer.

Each event retains its exact form, accession, issuer company association, original
SEC acceptance timestamp (or filing date when no timestamp exists), and primary
document link. SEC-supplied ownership XSL subdirectories are supported. Notices
without a primary document link to the accession's filing index. Unsafe paths and
conflicting metadata fail the scan rather than silently advancing coverage.
No complete filing document is archived by this event collector.

`filingCategory` classifies periodic/current reports, insider ownership, major
ownership, proxies, offerings, mergers/tenders, late notices, or other forms. It
does not restrict collection; new form types can still enter the feed. Financial
extraction and its Pub/Sub contract retain their separate financial-report scope.
The first notification experience is the existing event feed, without personal
email/push delivery or new subscription settings.

Coverage version 2 backfills from 2026-01-01 even for initialized issuers. Progress
uses `collectors/sec-{companyId}.linkScan` and batches of at most 100 records, with
a 1,000-row per-company pass limit, five archive pages per pass and the shared job
deadline. Partial scans resume within each page after the last committed
date/accession and skip already completed archives, including archive sets above
twenty pages; they do not advance `lastCompleteAt` or
the coverage version until complete. The frozen scan end date prevents a resumed
historical scan from claiming coverage of subsequent days. Regular complete scans
retain the seven-day overlap. Existing event IDs and first collection/processing
timestamps remain unchanged; historical imports keep their original timeline date.

Verification extends `tests/graph/map-disclosures.test.ts`: broad forms, real SEC
ownership path shapes, unknown forms, unsafe URLs, narrow financial extraction,
coverage upgrades, bounded resume and retry after transaction failure. No new
Firestore collection, index or per-theme rendering test is needed. Deployment
must include the SEC job's worker image before the hourly collector can backfill.
