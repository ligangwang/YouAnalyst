# Official company news collectors

The initial registry covers NVIDIA Newsroom, AMD Newsroom, Microsoft Corporate
Blog, and CoreWeave Blog. These are publisher-owned public RSS feeds, without
social providers, scraping, credentials, or paid enrichment. Add a publisher only
after checking its feed, company identity and exact article hosts.

## Storage and time semantics

The user-approved universal `events` collection stores normalized events across
source types. Its shared envelope includes `type`, `sourceType`, `sourceId`,
`companyIds`, canonical source URL, title, summary, publication dates and
immutable first-observed timestamps. This first collector writes
`type: company_news`, `sourceType: company_ir`. Event IDs are namespaced by kind
so other event types sharing a URL cannot collide. The news reader filters by
event type and source type before applying its bounded arrival window.

The user-selected shared `collectors` collection stores per-feed checkpoints,
HTTP validators, leases, baseline state and run health. Each collector owns one
document keyed by its stable source ID; it stores operating state, not events.

The first successful scan seeds baseline history. Baseline records do not count
as live arrivals or appear in intraday replay. Later newly discovered URLs become
arrivals with the actual collector observation time. Publisher dates remain
separate; missing publication time is never manufactured. An event identifies
its publisher company and makes no automatic relationship or impact claims.

Historical collection starts at publication date **2026-01-01**, inclusive.
Older articles are excluded even if they resurface later. Undated articles are
excluded from the first historical scan; subsequent discoveries can retain an
unknown publication date and their real observation time. Feed windows are
bounded and do not guarantee a complete archive since January.

Canonical URL hashes prevent duplicates, including reruns and articles that
disappear from and later return to the feed. CoreWeave's verified Webflow article
alias is normalized to its public canonical host; fetch targets cannot use that
alias. Transactions commit events and checkpoints together. HTTP validators,
hourly per-source checkpoints, two-minute leases, bounded response sizes
and provider Retry-After backoff keep collection bounded.

The snapshot reads at most 201 arrival records over 30 days and four health
documents, sharing its existing 60-second cache across browsers. The existing
UI refresh integrates arrivals into activity counts, event evidence and today's
replay. Failed, partial or stale feeds cannot report current IR coverage.

## Verification and rollout

1. Run `npx tsx scripts/collect-intelligence-news.ts` for read-only feed checks.
   This path never initializes Firestore.
2. Run `npx tsx --test tests/graph/news-collector.test.ts tests/graph/intelligence-service.test.ts`.
3. Apply the `events` composite index
   (`type ASC`, `sourceType ASC`, `baseline ASC`, `firstObservedAt DESC`)
   and wait until ready.
4. Build/deploy the isolated worker with
   `INTELLIGENCE_NEWS_COLLECTOR_ENABLED=1 bash scripts/deploy-background-jobs.sh intelligence-news`.
   Reuse the established maintenance runtime and scheduler identities.
5. Execute `collect-intelligence-news-production` once and verify all four
   checkpoints have a baseline, no failures and no partial coverage. The scheduler runs hourly Monday through Friday in America/New_York time. A new
   scheduler starts paused; resume it explicitly after the baseline succeeds.
6. Set production repository/environment variable `INTELLIGENCE_NEWS_ENABLED=1`
   and `INTELLIGENCE_NEWS_COLLECTOR_ENABLED=1`, then release the web application.
   Verify IR coverage and source links using the real snapshot. Future articles
   provide live arrivals; do not change baseline times to populate today's feed.

The collector is disabled by default, separately from the web read flag. Setting
`INTELLIGENCE_NEWS_ENABLED=0` and pausing the scheduler rolls the feature back
without deleting evidence. No browser accesses these collections directly.
