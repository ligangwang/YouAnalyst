# Official company news collectors

The initial registry covers NVIDIA Newsroom, AMD Newsroom, Microsoft Corporate
Blog, and CoreWeave Blog. These are publisher-owned public RSS feeds, without
social providers, scraping, credentials, or paid enrichment. Add a publisher only
after checking its feed, company identity and exact article hosts.

## Storage and time semantics

The user-approved universal `events` collection stores normalized events across
source types. Its shared envelope includes `kind`, `sourceType`, `sourceId`,
`companyIds`, canonical source URL, title, summary, publication dates and
immutable first-observed timestamps. This first collector writes
`kind: company_news`, `sourceType: company_ir`. Event IDs are namespaced by kind
so other event types sharing a URL cannot collide. The news reader filters by
kind and source type before applying its bounded arrival window.

**Still pending exact-name approval under AGENTS.md:** `intelligence_collectors`
stores per-feed checkpoints, HTTP validators, leases, baseline state and run
health. Do not enable collector writes until that approval is recorded.

The first successful scan seeds baseline history. Baseline records do not count
as live arrivals or appear in intraday replay. Later newly discovered URLs become
arrivals with the actual collector observation time. Publisher dates remain
separate; missing publication time is never manufactured. An event identifies
its publisher company and makes no automatic relationship or impact claims.

Canonical URL hashes prevent duplicates, including reruns and articles that
disappear from and later return to the feed. CoreWeave's verified Webflow article
alias is normalized to its public canonical host; fetch targets cannot use that
alias. Transactions commit events and checkpoints together. HTTP validators,
five-minute per-source checkpoints, two-minute leases, bounded response sizes
and provider Retry-After backoff keep collection bounded.

The snapshot reads at most 201 arrival records over 30 days and four health
documents, sharing its existing 60-second cache across browsers. The existing
UI refresh integrates arrivals into activity counts, event evidence and today's
replay. Failed, partial or stale feeds cannot report current IR coverage.

## Verification and rollout

1. Run `npx tsx scripts/collect-intelligence-news.ts` for read-only feed checks.
   This path never initializes Firestore.
2. Run `npx tsx --test tests/graph/news-collector.test.ts tests/graph/intelligence-service.test.ts`.
3. After checkpoint-storage approval, apply the `events` composite index
   (`kind ASC`, `sourceType ASC`, `baseline ASC`, `firstObservedAt DESC`)
   and wait until ready.
4. Build/deploy the isolated worker with
   `INTELLIGENCE_NEWS_COLLECTOR_ENABLED=1 bash scripts/deploy-background-jobs.sh intelligence-news`.
   Reuse the established maintenance runtime and scheduler identities.
5. Execute `collect-intelligence-news-production` once and verify all four
   checkpoints have a baseline, no failures and no partial coverage. A new
   scheduler starts paused; resume it explicitly after the baseline succeeds.
6. Set production repository/environment variable `INTELLIGENCE_NEWS_ENABLED=1`
   and `INTELLIGENCE_NEWS_COLLECTOR_ENABLED=1`, then release the web application.
   Verify IR coverage and source links using the real snapshot. Future articles
   provide live arrivals; do not change baseline times to populate today's feed.

The collector is disabled by default, separately from the web read flag. Setting
`INTELLIGENCE_NEWS_ENABLED=0` and pausing the scheduler rolls the feature back
without deleting evidence. No browser accesses these collections directly.
