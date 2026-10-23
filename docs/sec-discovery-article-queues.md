# SEC company discovery and article enrichment

The hourly SEC job dispatches one `sec.company.discovery.requested` message per
enrolled US company. A private subscriber reads that company's current membership,
then runs financial filing discovery, public disclosure discovery and the earnings
observer against one shared submissions response. All requests still use the
existing global SEC spacing/cooldown gate. The public ticker directory is reused
for five minutes per worker process. There is no nightly bulk download.

Existing per-company financial baselines, overlap windows and archive progress
remain in `sec_collector_state`. Company leases use existing lease fields on
`_discovery_TICKER` documents in that collection. The direct compatibility path
uses the same fences. The dispatcher repairs the existing filing outbox, including
withdrawn companies' pending deliveries, before accepting new discovery work.
Financial and earnings cursors do not advance past an unconfirmed intake handoff.
Website freshness is aggregated from completed financial/disclosure/earnings
coverage of every enrolled company, rather than accepted queue messages.

The news job selects indexed due articles and dispatches one
`news.article.enrichment.requested` message per article. A task carries the article
ID, a source fingerprint and its admitted stages: analysis, headline translation
and calendar extraction. A dispatch admits at most 20 analysis articles, 40
headlines and 25 calendar sources. It does no article download or AI work.
Subscribers recheck enrollment, source identity, due markers and existing paid
intents. A source edit invalidates an older task. Analysis/calendar stages share
one in-memory article download. The existing transactional monthly analysis
budget and uncertain-charge receipts remain authoritative; retries never clear
paid intents. Temporary source failures keep the existing backoff. Independent
articles can finish even while another publisher is unavailable.

Both subscribers use private authenticated Pub/Sub push, concurrency one and at
most two instances. Dead-letter queues retain messages for inspection. SEC workers
receive the existing SEC contact configuration; only article workers receive the
already approved AI key, through a protected temporary environment file. No new
Firestore collection, persisted field, index or backfill is introduced. Article
lease documents reuse existing lease fields in `collectors`.

## Release and activation

1. Merge only after required CI passes and reviews, inline comments and final diff
   have been inspected. Build the shared worker image from that exact merged SHA.
2. Additively provision the two new private resources with the reviewed image:
   `DISCOVERY_ENRICHMENT_BOOTSTRAP_IAM=1 bash scripts/deploy-discovery-enrichment.sh sec`
   and the same command with `article`. Setup reuses the existing runtime/push
   identities and grants only resource-scoped access. It does not switch any job.
3. Persist `SEC_DISCOVERY_QUEUE_ENABLED=1` and
   `NEWS_ENRICHMENT_QUEUE_ENABLED=1` in the GitHub production environment. Routine
   releases use bootstrap zero and fail closed if resources/access are missing.
4. Normal background deployment provisions/verifies subscribers before updating
   their publishers. SEC first deploys the compatible direct-mode job, lets older
   executions finish naturally, then sets its discovery request topic. No existing
   job, schedule or subscription is stopped. A drain timeout leaves collection
   running in direct mode and fails the release for investigation.
5. Validate one bounded company task and article task, their receipts/cursors and
   downstream handoffs. Keep the current website revision serving while validating
   its replacement, then follow promotion and production smoke checks. Existing
   schedules remain enabled. SEC raw-cache holds, 90-day completion retention and
   all public SEC links remain unchanged.

Setting a request topic empty selects the compatible direct execution path for
future scheduled jobs. Leave existing subscriber delivery and backlog intact;
inspect/fix a failure before retrying. Cached calendar revalidation remains an
explicit administrative operation and never makes a new paid request.
