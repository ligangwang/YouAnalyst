# Official company news collectors

The verified registry covers 18 AI Map companies: NVIDIA, AMD, Microsoft,
CoreWeave, Broadcom, Marvell, KLA, Applied Materials, Lam Research, NXP,
GlobalFoundries, Datadog, Arm, Alphabet/Google, Amazon, Apple, Intel,
and Arista. Sources are publisher-owned public RSS/Atom news,
IR and corporate research feeds, without social providers or paid enrichment.
Their configured company IDs are checked against the published AI Map. This
is partial company coverage, not a claim that every AI Map company is monitored.
Samsung Global Newsroom passed local validation but returned HTTP 403 from Cloud
Run during the initial import. It is excluded from active coverage until verified
from the production runtime; its failed checkpoint is retained for audit. The
18 active collectors imported 168 new articles, bringing eligible stored 2026
news to 265.

Feed windows contain recent publications and are not complete 2026 archives.
Each publisher was tested for valid articles, original publication fields,
exact article hosts, and the January 1, 2026 history cutoff.

The collector identifies itself as `YouAnalyst/1.0`. Including a parenthesized
contact URL in the User-Agent caused otherwise valid IR feeds to time out.
Two independent publishers run concurrently, retaining individual leases,
conditional HTTP validators, retry backoff, and stable result ordering. One
publisher failure does not discard successful collection from another.

Apple's Atom feed has `updated` without `published`. Its adapter reads the
visible `category-eyebrow__date` from the article and keeps `published_at: null`;
Atom update timestamps and article modification dates never enter replay.
Missing visible dates fail the scan without advancing validators or known IDs,
so the same articles are retried after backoff. Only resolved article IDs become
known. Subsequent scans fetch only unseen articles.

CoreWeave's RSS and JSON-LD publication fields can reflect a CMS rebuild rather
than original publication. Its collector reads the article's visible `Published
on` date instead, leaves `published_at` null, and excludes these date-only items
from intraday replay. Article requests use the same approved hosts and size
limits, a 60-second total budget and concurrency of four. Later scans fetch only
previously unseen article IDs. Original dates before January 1, 2026 are excluded
from the initial import. The one-time repair script defaults to a read-only plan,
preserves `collected_at`, and retains out-of-window records with an unsupported
version so they cannot enter public timelines.

## Storage and time semantics

The user-approved universal `events` collection stores normalized events across
source types. Its shared envelope includes `type`, `sourceType`, `sourceId`,
`companyIds`, canonical source URL, title, summary, `published_at`, immutable `collected_at`, and `processed_at` in UTC. This first collector writes
`type: company_news`, `sourceType: company_ir`. Event IDs are namespaced by kind
so other event types sharing a URL cannot collide. The news reader filters by
event type and source type before applying its bounded publication window.

The user-selected shared `collectors` collection stores per-feed checkpoints,
HTTP validators, leases, baseline state and run health. Each collector owns one
document keyed by its stable source ID; it stores operating state, not events.

The first scan seeds baseline history. Baseline is an ingestion classification,
not an investor timeline timestamp. All investor feeds, graph activity and replay
use `published_at`; historical imports retain their original publication position.
Date-only sources keep `published_at: null` and `publication_date`; they appear as
dates and do not participate in intraday replay. Fully undated items stay in
storage without being inserted into dated timelines. `collected_at` measures
first successful source ingestion; `processed_at` measures normalization completion.
Public API projections omit both operational fields. No admin endpoint is added;
any future monitoring endpoint must enforce admin authorization server-side.
SEC acceptance time is preserved when supplied. Legacy filings without it show
their filing date, never their detection or Pub/Sub dispatch time.

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

The snapshot reads at most 201 exact-time and 201 date-only records over 30 days, returns at most 200 events, and reads one health
document per configured feed, sharing its existing 60-second cache across browsers. The existing
UI refresh integrates publications into activity counts, event evidence and today's
replay. Failed, partial or stale feeds cannot report current IR coverage.

## Verification and rollout

1. Run `npx tsx scripts/collect-intelligence-news.ts` for read-only feed checks.
   This path never initializes Firestore.
2. Run `npx tsx --test tests/graph/news-collector.test.ts tests/graph/intelligence-service.test.ts`.
3. Apply the `events` composite index
   (`type ASC`, `sourceType ASC`, `published_at DESC`) and the date-only index
   (`type ASC`, `sourceType ASC`, `published_at ASC`, `publication_date DESC`)
   and wait until ready.
4. Build/deploy the isolated worker with
   `INTELLIGENCE_NEWS_COLLECTOR_ENABLED=1 bash scripts/deploy-background-jobs.sh intelligence-news`.
   Reuse the established maintenance runtime and scheduler identities.
5. Execute `collect-intelligence-news-production` once and verify all four
   checkpoints have a baseline, no failures and no partial coverage. The scheduler runs hourly Monday through Friday in America/New_York time. A new
   scheduler starts paused; resume it explicitly after the baseline succeeds.
6. Set production repository/environment variable `INTELLIGENCE_NEWS_ENABLED=1`
   and `INTELLIGENCE_NEWS_COLLECTOR_ENABLED=1`, then release the web application.
   Verify IR coverage and source links using the real snapshot. Articles use their original source dates; never shift history to the import time.

The collector is disabled by default, separately from the web read flag. Setting
`INTELLIGENCE_NEWS_ENABLED=0` and pausing the scheduler rolls the feature back
without deleting evidence. No browser accesses these collections directly.

## Compact dashboard summary

The bottom bar exposes an explicit Today / 30d activity period, using the same
filters as the evidence panel. Today always means original publication date in
New York time; it can correctly be zero after midnight or on quiet days. 30d
shows retained evidence from the existing bounded 30-day API window. Neither
backfilling nor polling changes an article's publication position.

`newsCoverage` exposes configured, healthy and total company counts, without
operational timestamps. The compact News N/total badge shows configured feed
coverage; its tooltip separately reports healthy collectors. Unknown/unconnected
GitHub, X and Reddit sources remain unavailable rather than showing fake zeros.
Collector freshness follows the approved weekday hourly schedule. Weekend
pauses do not make a successful Friday collector stale; a missed Monday run,
failed scan or partial scan still does.
