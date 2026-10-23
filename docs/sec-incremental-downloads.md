# Hourly incremental SEC downloads

This mode makes no nightly bulk downloads, creates no ZIP archives, and introduces
no Firestore collection, field or index. It reuses existing per-company filing
cursors, immutable accession/event IDs, outbox and downstream processing queues.

With `SEC_INCREMENTAL_DOWNLOADS_ENABLED=1`, the existing SEC collector runs hourly
and checks enrolled US companies for unseen filings. Its seven-day overlap and
resumable archive cursors remain intact. Initial observations remain baselines,
not newly arrived activity. Work remains bounded by the existing collector limits;
this does not claim that discovery itself is now horizontally sharded.

The collector publishes the original filing event to `sec-filing-download-requests`.
`sec-filing-download-subscriber` stores its primary financial document in a private
GCS bucket before publishing the unchanged event to `sec-filings-discovered`.
Existing fundamentals and graph subscriptions keep their topic and event identity.
The same SEC scanner's raw-submissions observer discovers 8-K/6-K earnings
candidates and immediately dispatches only its own committed earnings discoveries
through the unified intake. No second US earnings discovery poller is introduced.
Publication is deadline-bound and limited to 100 tasks; the existing durable
earnings outbox sweep repairs deferred or uncertain publication through the same
intake router. A-share earnings bypass SEC intake and keep their existing queue.
Publication failures retain the download for replay. Concurrent cache misses may
perform redundant SEC reads, but generation preconditions prevent overwriting a
previously stored original. Successful subsequent attempts reuse that original.

Downloads use the existing shared SEC request gate and cooldown, including its
application-wide request spacing. Bodies are bounded to 20 MiB. Private objects use
the `sec-document-cache/v1/<CIK>/<accession>/<document>` prefix, with original SEC
URL, download timestamp, SHA-256 and processing owners in object metadata. Readers
verify the hash. URLs outside the canonical HTTPS SEC archive are rejected.

Small private `sec-document-work/v1/<owner>.json` manifests retain that provenance
long-term and record every accession touched by a processing task. Completion
uses these manifests after retries, including cases where the latest annual report
differs from the filing that triggered refresh. Raw-byte cleanup leaves manifests
and existing extracted results intact.

Only successful durable fundamentals results and graph completion receipts clear
their processing ownership. SEC earnings workers also reuse cached reports,
indexes and exhibits, preserving their canonical source URLs. Failed, deferred,
manual-review or unresolved work retains its hold. The fetch stage covers primary
financial reports, official earnings indexes and individually discovered earnings
reports/exhibits. Earnings expansion publishes child tasks through intake before
extraction, so cached bytes are durable before tasks enter the earnings processing
queue. It never guesses exhibit filenames or downloads all attachments eagerly.
Fundamentals, earnings and relationships remain separate queued deliveries with
independent retries and processing holds, sharing raw objects by SEC URL.
Structured financial facts/submissions JSON keep their existing incremental API
path; mutable API responses are not cached as immutable filing documents.

## Retention

New cached originals have a GCS temporary hold. A metadata compare-and-swap records
completion independently for each registered processor; the hold clears only when
all are complete. A new processor restores the hold. Cleanup retains originals for
at least 90 days after the last processing completion (and after download), which
is deliberately conservative when processing is delayed. Pending or failed files
remain protected even after 90 days. Unknown or malformed state fails closed.

The hourly `cleanup-sec-downloads-production` job deletes at most 100 eligible
objects per run and has an eight-minute work deadline. It uses generation
preconditions; storage holds also protect a file if a processor registers during
cleanup. It never deletes extracted results or provenance in Firestore. A bucket
with age-only Delete lifecycle rules is rejected because such rules cannot enforce
processing-aware retention. Keep this cache bucket dedicated and private.

User-facing filing, earnings and evidence links remain HTTPS SEC URLs. No GCS URL,
signed URL or internal object key is substituted into a public result. Original
filing events and existing source models cross the queue boundary unchanged.

## Deployment and rollback

Build the shared maintenance image, including `serve-sec-downloads.cjs` and
`cleanup-sec-downloads.cjs`. Choose `SEC_DOCUMENT_CACHE_BUCKET` and provision the
private bucket, object access and queue resources with
`SEC_DOWNLOAD_BOOTSTRAP_IAM=1 SEC_INCREMENTAL_DOWNLOADS_ENABLED=1 bash scripts/deploy-sec-downloads.sh`.
This does not switch the running collector or stop existing schedules. Setup uses
existing maintenance and push identities with resource-scoped roles; it grants no
public access or project-wide role. The newly created cleanup schedule starts
paused, following the existing scheduling helper; enable this new schedule after
checking its dry run. Never pause existing collection schedules during rollout.

Routine deployment keeps bootstrap off and checks resources, bucket privacy,
storage access and exact subscription/topic ownership before building. Deploy
fundamentals and graph consumers with the same cache bucket before switching the
SEC collector. The background deployment order already puts these consumers
before `sec-filings`; earnings receives the cache configuration on its deployment.
The router is deployed before updated earnings workers can publish exhibit tasks;
all processing consumers deploy before the collector switches. When earnings is
enabled, deployment includes that consumer as a dependency. Collector activation
checks each consumer's cache bucket, enabled mode and exact release SHA. The
collector schedule changes to hourly only in this opt-in mode. Release
workflow variables expose the flag and bucket; defaults preserve direct operation.

Verify a bounded filing through download, both existing consumers, retention
holds, duplicate delivery and public SEC citations before declaring activation
complete. Monitor download/dead-letter backlog, per-company cursor freshness,
shared SEC cooldowns, storage integrity errors and pending cache holds. Collector
success means accepted downloads, not completed downstream processing.

For rollback, keep the cache bucket on consumers until already queued processing
has drained, while switching only the collector flag off to restore direct event
publication. Preserve both subscriptions and storage. Do not remove the bucket
configuration from consumers before the pending cache owners are resolved. The
cleanup command defaults to dry-run; `--apply` enables bounded deletion.
