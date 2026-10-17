# Change-driven data caches

Graph directories, themed graphs, price timelines, peer comparisons, earnings,
news source configuration, collector status, calendar views/links, fundamentals,
leaderboard counts, track records, analyst badges and database-backed sitemaps no
longer expire on elapsed time. SEC identity mappings refresh on company/directory
changes. Provider collection schedules, retry cooldowns, freshness warnings,
authentication expiry and job leases are separate and remain enforced.

Each cached read checks the existing `collectors/_read_cache_versions_v1`
document. Eventarc sends authenticated Firestore write events (including deletes)
to `/api/internal/cache-changes`, which changes the affected collection's version.
Only entries depending on that collection are rebuilt on subsequent requests.
Unrelated writes leave entries intact. A delayed/duplicate event invalidates again;
it cannot restore an older generation. An in-flight old read cannot replace a newer
entry. Errors are never cached. Metadata-check failures surface rather than serving
unverified stale data. Missing/disabled configuration bypasses caching.

Versions are shared across processes; values are per-process, bounded to 1,024
entries. A restart or capacity eviction can cause an initial reread. This is not
zero-read operation: requests still check metadata, and relevant collection changes
can rebuild a whole view. Eventarc is asynchronous; changes become visible after
delivery. Each accepted event adds one metadata write and a Cloud Run invocation;
the metadata write's own event is ignored to prevent recursion. Monitor event
delivery failures/backlog and Firestore read/write counts after rollout. Do not
promise a project-wide few-thousand-operation budget from this change alone.

The feed retains its persistent incremental seven-day cache. Graph prices retain
their separate persistent two-session cache and atomic EOD/history writer updates.
Calendar-day windows and clock-dependent freshness are recalculated from cached
inputs; they do not expire source caches. HTTP data responses revalidate with the
server (`no-cache`), rather than keeping an independent browser/CDN TTL. Static
media/assets keep their existing HTTP caching.

## Deployment

Production deployment calls `scripts/setup-cache-changes.sh`. It bypasses caches
during setup, verifies existing collection-scoped Eventarc triggers, and configures
the receiver audience. Before the first release, an administrator runs the script
with `CACHE_BOOTSTRAP=1` to provision the dedicated `cache-events` identity, IAM
bindings, and triggers. Routine deployments need `roles/eventarc.viewer` alongside
their existing Cloud Run, service-account-user, and Firestore permissions; they do
not create identities or change project IAM policies. Missing triggers fail with
a bootstrap instruction instead of attempting privileged provisioning.
The Firestore project and Cloud Run project must match for this setup script.
No new Firestore collections are created.

`scripts/activate-change-cache.mjs` writes a nonce to
`collectors/cache-change-probe`, waits for its authenticated delivery acknowledgement,
then enables the registry and resets versions. Failed setup leaves the cache bypassed.
Use `GCP_PROJECT_ID=... node scripts/activate-change-cache.mjs --disable` to bypass
the cache for incident response. Trigger delivery must remain operational; disabling
the trigger without bypassing caches can leave cached data stale.

Live trigger provisioning and delivery are deployment checks, not covered by local
unit tests. Local tests cover cache behavior and event validation without credentials.
