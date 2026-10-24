# Company page cold-read latency

## Production evidence

On revision `ifindata-web-00836-lad`, the request for
`/en/company/interpump-group-s-p-a-adr` at 2026-10-24 00:14:30 UTC
completed in 22.573 seconds. Logs for that same Cloud Run instance show:

- Autoscaling started the instance at 00:14:30.170; Next was ready at 00:14:31.810.
- A cold companies SQLite snapshot read completed at 00:14:45.317 (9,657 ms).
- The relationships snapshot completed at 00:14:46.440 (455 ms).
- The fundamentals snapshot completed at 00:14:51.279 (3,879 ms).

These are request completion times, not browser first-paint measurements. They
establish a contributing cold-cache dependency chain, not an exhaustive diagnosis
of every slow response. Slow successful requests continued after rollout warmup.

Production validation of the first fix exposed an announcement-panel escape: an
11.057-second company request on revision `00839-koj` overlapped a 9,000 ms,
160,821,248-byte companies snapshot read. Announcements had loaded the global
news-source directory outside the page scope. They now read only the requested
company's approved sources through the bounded push cache, retaining published
theme, enrollment, deletion and publisher approval checks. Collector-wide source
discovery retains its existing behavior.

## Change

Company routes, metadata, classifications, fundamentals, comparisons and their
graph reads select the existing targeted push caches through an async read scope.
Identity lookups subscribe to the exact document or bounded slug/ticker query;
financial reads subscribe to the requested IDs; graph enrollment uses the
existing theme-filtered queries. A company page no longer downloads the full
company/fundamentals SQLite files as a prerequisite. Metadata and the overview
also share one graph computation per React render request.

The policy applies to company-page loaders and the public graph response used
by company charts. Bulk directory/search/sitemap readers keep the file-backed
directory, workers keep their existing policy, and
transactions/live reads retain authoritative SDK behavior. No new persisted
fields, collections, indexes, migrations, provider calls or credentials are used.
Subscriptions still coalesce concurrent visitors, receive source updates, and
use existing count/byte eviction budgets. This trades a bounded initial source
subscription for the previous full-file transfer; it does not poll on every view.

## Verification

The regression fixture enables the real file-directory policy alongside targeted
subscriptions. Twenty concurrent cold identity/fundamental reads must open only
two subscriptions and zero snapshot files, reuse them on later visits, apply
updates/deletions, preserve direct live reads, restore the bulk policy after a
rejected render, and still load a file for an ordinary bulk reader. Existing
cache, graph, projection and identity tests protect content/authorization behavior.

After deployment, compare fresh-instance company requests and
`entity_snapshot_file_read` logs with this baseline, alongside response errors
and health. Do not infer a production latency percentile from local unit tests.

## Remaining cold-start work

The next change removes sequential dependencies without omitting page content.
Company metadata shares the identity/relationship structure with the page but no
longer waits for valuation enrichment. The complete page graph enriches a copy;
US and A-share valuation reads run together with the same batching, validation
and independent failure handling. Earnings, announcements and canonical identity
reads run concurrently, including on A-share pages. Metadata and page rendering
share earnings reads per React request. Independently bundled routes also share
the pending published theme catalog. First Firestore listener snapshots now log
their elapsed duration so subsequent cold-start analysis can distinguish startup,
source reads and rendering. No persisted application schema changes are needed.

Production validation on revision `00845-jat` identified a second cold path:
peer comparisons still selected ticker/year price files despite requesting only
12 observations. A Microsoft response took 4.675 seconds and its surrounding
ten-second window contained 51 price synchronization callbacks. Company-page
price queries limited to at most 12 rows now use the existing exact-query push
cache instead. They retain the ticker/date filters, ordering, limit, correction
updates and eviction budget. Larger chart histories and bulk readers continue
to use partition files. A regression checks 20 concurrent visitors, date/ticker
isolation, all 12 observations, pushed corrections and unchanged bulk behavior.

Further scale-out validation found 12.311- and 13.575-second company responses
on a newly used instance. Company charts also request `/api/knowledge-graph`,
whose loader had escaped the targeted page scope. The same instance's API
activity included whole-company and relationship file reads (11.990 and 3.477
seconds). These overlapping observations identify another contributing cold
dependency; they do not prove that file I/O accounts for the entire response.
The public graph route now selects targeted published-company, relationship and
valuation subscriptions too. Theme validation, complete graph output, errors
and response headers are unchanged. A bundled HTTP regression exercises twenty
concurrent requests, pushed corrections, invalid themes and source failures with
zero full snapshot reads; unrelated bulk reads retain their original policy.
