# Company and instrument readiness

Release requires explicit user authorization, verified additive migrations and
the normal protected deployment process. Never run migrations during app startup.

## Readiness contracts

`companies.onboarding` certifies shared issuer readiness: canonical identity/CIK,
reviewed profile, evidenced themes, and event routing. SUPPORTED
enrolls the company in scheduled maintenance; fundamentals may still be pending.
`instruments.onboarding` certifies listing readiness: linked issuer, corporate
actions, price history, and final validation. Financial/market-cap data may still
be pending and is maintained by independent regular jobs. A company
can be SUPPORTED while one of its instruments is still onboarding or blocked.

Both explicitly approved maps contain:

| Field | Value |
| --- | --- |
| status | QUEUED / PROCESSING / BLOCKED / SUPPORTED |
| version | 1 |
| requestedAt | Timestamp or null |
| startedAt | Timestamp or null |
| supportedAt | Timestamp or null |
| updatedAt | Timestamp |
| blockedReason | Safe public reason or null |

Absent map means directory-only. There is no second support boolean. Existing
178 themed companies are grandfathered by the staged company migration; this
acknowledges existing service, not a fresh backfill verification.

`loadSupportedCompanies` is the shared issuer selector. It queries
`companies.onboarding.status == SUPPORTED` and excludes deleted, hidden, nameless,
and superseded records. Company financial/disclosure/news jobs use this set.

`loadSupportedInstrumentUniverse` is the shared listing selector for ordinary EOD
price/action maintenance and price-history tools. It queries
`instruments.onboarding.status == SUPPORTED`, requires its company to be supported,
and excludes deleted/delisted or unmapped instruments. Explicit manual repairs,
existing prediction obligations, and the track-record benchmark retain their
existing scope. A new listing is never admitted just because its issuer is ready.
The queries use single-field indexes; no new composite index is introduced.

## Instrument request queue

The approved collection is **`instrument_onboarding_requests`**, keyed by stable
`INS_...` instrument ID. The old staged `company_onboarding_requests` collection
was never created in production; there is no live collection to rename.

Approved document fields: `instrumentId`, `companyId`, `version`, `status`,
`requestedByUid`, `requestedAt`, `updatedAt`, `targetThrough`, `steps`, `attemptCount`, `nextAttemptAt`,
`leaseOwner`, `leaseExpiresAt`, `lastError`. Request timestamps are ISO strings;
retry/lease times are Unix milliseconds. `steps` maps fixed stage names to COMPLETE.

Stages run in order:

1. identity (instrument-to-issuer linkage)
2. themes (company)
3. profile (company)
4. events (company readiness verification and admission)
5. corporateActions (instrument splits and dividends)
6. prices (instrument historical prices)
7. verify (identity, company eligibility and persisted backfills, then instrument admission)

A supported issuer reuses its theme/profile/event checkpoints. There is no graph,
fundamentals, earnings, or market-cap checkpoint or prerequisite. Theme assignments
remain required. Older staged COMPLETE graph/fundamentals/metrics checkpoints are
accepted but ignored. Regular jobs collect financials and earnings and calculate
market caps after admission. Onboarding does not access financial storage or start
financial collectors. Final validation reads the frozen price/action backfills and
verifies their persisted records before instrument admission.
Company work is serialized across requests for that issuer through transactional
checks of existing request leases. Another listing cannot overwrite a supported
company's status with QUEUED or BLOCKED. No extra coordination fields are added.

Reviewed theme batches use the existing enrollment format. Missing classifications
block for review; the worker never fabricates themes or commercial relationships.
Prices and actions start at **2020-12-30**, naturally beginning at listing inception
when later. Both split/dividend responses must validate before publishing actions;
empty successful responses are valid. Existing corporate-action storage retains raw
dividend values in sourcePayload. Price history preserves existing historical keys.
Issuer reports are shared, but one share class never inherits another class's
market cap, share assessment, or corporate actions.

One message advances consecutive steps, checkpointing every success. A 20-minute
fenced lease prevents stale completion. All failures block immediately with no
automatic step retry; explicit admin retry preserves the completed checkpoints.
Date rollover clears only instrument history/final validation checkpoints
for catchup; company readiness remains intact. Final admission checks stored bars,
issuer identity, persisted corporate actions, identity stability, and the current cutoff.
`INSTRUMENT_ONBOARDING_MAINTENANCE_READY=1` is an operator release attestation;
set it only after normal issuer and instrument maintenance is verified.

## Registered-user search

Universal search uses bounded indexed `scope=directory` queries, not a full scan or
synthetic editorial companies. It reads instrument summaries and canonical issuer
links in bounded batches. Public results expose no private queue errors or leases.
Its hint reads "{count} stocks featured" using the existing supported-company
count endpoint; the count does not restrict directory search results.

`POST /api/instrument-onboarding/requests` accepts `{instrumentId, listingId?}`.
A registered non-anonymous Firebase bearer token is verified before Firestore
access. Missing instrument records can be initialized only from the matching
existing public listing record and its canonical company. US requests need a
matched issuer CIK; existing XSHG/XSHE provider support is used for A-shares.

Supported results retain chart actions; other results open their company profiles.
Eligible listings show **Request Full Support**, or a sign-in action for guests.
Accepted states show **Onboarding Queued**, **Onboarding…**, or
**Onboarding Needs Attention**. Missing US CIK shows **CIK not matched**.
Requests deduplicate per instrument. They never execute providers or auto-resume a
blocked request. `requestedByUid` is the verified Firebase UID from the bearer
token, never a client-provided identity. `requestedAt` is the server-generated
request time. Duplicate users/requests, checkpoints, and retries preserve the
original UID and time on the shared job. Each distinct user also gets an immutable
record in the approved `instrument_onboarding_requests/{instrumentId}/requesters/{hashedUid}`
subcollection, containing only `requestedByUid` and `requestedAt`. The UID is hashed
for a safe document key; the stored UID remains the exact authenticated identity.
Repeated clicks by one user preserve that user's first request time. New users
append attribution in the same transaction without changing the job status,
lease, checkpoints, or retry timestamps; no additional workflow is created.
Existing first-request attribution is seeded into this subcollection when needed.
These details appear only in the admin API/page, not
public company/instrument summaries or search responses. No per-user quota fields
are added.

## Admin page and safe retries

`/admin/instrument-onboarding` is protected by the existing admin layout and every
API operation independently authenticates and checks the existing admin role.
The page shows separate company/instrument states, completed and current steps,
last error, attempts, requester UID, request/updated times, cutoff, retry eligibility, and lease
expiry. Pages are bounded to 25 requests with a continuation cursor. Each job
has a View all requesters disclosure, loaded on demand in independent 25-user
pages using the same admin-authenticated API. Requesters never appear in public
search results.

GET `/api/admin/instrument-onboarding` returns private, non-cacheable summaries.
POST accepts `{instrumentId, step, updatedAt}`. Retry checks the current first
unfinished step and optimistic timestamp, refuses active leases/completed/changed
requests, clears the failure/backoff, and queues that checkpoint. Completed work
is preserved. It does not reset financial collector failures. The page never calls
providers or dispatches an execution. Error
messages are sanitized; credentials and provider URLs are not exposed publicly.

## Staged operator tools

The maintenance image includes `dist/onboard-instruments.cjs` without changing its
default command. The protected background rollout enables `INSTRUMENT_ONBOARDING_ENABLED=1`
and deploys `onboard-instruments-production` with the reviewed pinned shared image,
existing maintenance identities and private EODHD bucket/credential. A private Cloud Run subscriber receives Eventarc messages on writes to
`instrument_onboarding_requests/{instrumentId}`. New requests and explicit admin
retries start immediately. No polling schedule or recovery schedule is used.
The old onboarding schedule is removed only after the subscriber and trigger are
ready and an authenticated, provider-free message delivery check passes against
the exact reviewed revision. The manual Cloud Run job remains available for operator preview/inspection.

A message processes consecutive checkpoints within a bounded run. Each completed
step is committed before the next starts; messages read current state rather than
stale payloads. Checkpoint writes also emit durable continuation messages. Duplicate
messages and issuer contention respect the existing fenced leases. Transport
redelivery may continue **unfinished ready work**, but never a failed provider step.
All step errors become BLOCKED with `nextAttemptAt=0`; only explicit admin retry
clears them. Expired PROCESSING leases are blocked for inspection because the last
provider operation may have had an unknown outcome. Old queued failures and legacy
theme blockers are never automatically resumed.

The subscriber is configured with ten warm instances and two HTTP slots per instance, with at most one onboarding operation per instance. Warm instances incur baseline infrastructure costs even when the queue is idle. Historical price writes are capped at
200 records per batch with the existing one-second pause; corporate actions
retain their five-record batches. Workers check a shared safety signal before
starting and before each price or corporate-action batch. If monitoring reports
capacity errors or its heartbeat is older than three minutes, workers defer
without discarding completed checkpoints or automatically retrying provider errors.

The signal uses `pauseNewBatches` (boolean) and `monitorHeartbeatAt` (timestamp)
in the existing `collectors/instrument-onboarding-safety` document. These new
persisted fields require explicit user approval before creation. The read-only
monitor command is `npx tsx scripts/monitor-onboarding-capacity.ts`; the
`--write-control` option writes the signal and must not be used before approval.
The monitor checks website health, recent capacity errors, cache event backlog,
onboarding delivery age, and recorded OpenAI usage estimates. The usage ledger
is not an authoritative API credit balance or invoice. The monitor must run at
least once per minute; if the local monitor or its credentials are unavailable,
new onboarding work waits until monitoring recovers.

One-time operator setup runs `scripts/setup-instrument-onboarding.sh` before the
protected rollout. It grants the deployment account only Eventarc trigger create
and update permissions (existing viewer access is reused), and grants the existing
delivery account Eventarc receiver access. Routine CI never modifies project IAM.

No Firestore schema changes are required. Eventarc uses the existing request
collection as the durable message source (including admin and batch request flows).
It ignores requester subcollections. Existing untouched QUEUED documents predate
this trigger: use the explicit operator wake command during migration to emit a
message for ready requests; never wake BLOCKED/failed requests automatically.

```
npx tsx scripts/onboard-instruments.ts                         # preview only
npx tsx scripts/onboard-instruments.ts --instrument=INS_... --listing=US:EXAMPLE --requester=<Firebase-UID> --enqueue
npx tsx scripts/onboard-instruments.ts --process --limit=1
npx tsx scripts/onboard-instruments.ts --instrument=INS_... --retry
npx tsx scripts/onboard-instruments.ts --instrument=INS_... --wake # ready pre-trigger request only
```

The approved company migration remains dry-run by default:
`GOOGLE_CLOUD_PROJECT=<project> npx tsx scripts/migrate-company-onboarding.ts`.
Its prior read-only preview scanned 24,008 companies and selected 178; zero writes.
Backups are under `output/company-onboarding-backups/`.

After company migration, preview the instrument grandfather migration with
`GCP_PROJECT_ID=<project> npx tsx scripts/migrate-instrument-onboarding.ts --source-backup=<frozen-company-migration-backup>`.
It selects only priceable US/XSHG/XSHE listings from that frozen legacy list,
reports private/non-priceable company profiles as skipped, checks canonical support and instrument
identity, rejects active onboarding, saves a backup, and requires `--write` for
writes. Writes are fenced and throttled to five per batch with one-second pauses.
No migration is executed by the UI or application startup. Before release,
coordinate additive migrations, cache convergence, required indexes, and an
availability monitor; stop new batches on capacity errors. Production remains
unchanged until explicit release authorization.


## Admin batch requests (staged)

`POST /api/admin/instrument-onboarding/requests` accepts an authenticated,
non-anonymous Firebase admin ID token. Admin status uses the existing verified
claims/account role check; an email address, payload UID, or system flag never
grants access. The server always passes the verified admin UID to the same
requester-recording and instrument-job transaction as individual requests.
No new account, role, collection, or persisted field is introduced by this API.

Request example (IDs come from directory search):

```json
{
  "items": [
    {"instrumentId": "INS_<32 lowercase hex digits>", "listingId": "US:EXAMPLE"},
    {"instrumentId": "INS_<another 32 lowercase hex digits>"}
  ]
}
```

Send `Authorization: Bearer <Firebase-ID-token>`. `listingId` is optional for
existing instrument records; a missing record requires the verified matching
legacy directory listing. Batches contain 1–25 items, at most 16 KiB. Requests are
processed sequentially with a 200 ms pause between storage submissions, and
repeated instrument IDs in one batch share the accepted result. Across concurrent
batches and ordinary users, the existing transaction still creates only one job
per instrument and one first-request record per user. Nothing executes providers,
dispatches workers, resets blocked requests, or changes existing checkpoints.

The response preserves input order and includes per-item `index`, `instrumentId`,
`companyId` when known, current `status`, and `outcome`: QUEUED, ALREADY_REQUESTED,
ALREADY_SUPPORTED, REJECTED, ERROR, or DEFERRED. BLOCKED/PROCESSING/QUEUED jobs
return ALREADY_REQUESTED and retain their actual status. Invalid items are rejected
individually; malformed/empty/oversized/over-limit batches are rejected before any
submission. HTTP 200 can include per-item rejections (`ok: false`).

An operational storage error returns HTTP 503 with partial results and stops new
submissions; remaining unattempted instruments are DEFERRED. Previously accepted
duplicates can still return their known result. Retry the same batch safely;
existing jobs, request times, requester records and leases are preserved. Raw
storage diagnostics are not exposed. The endpoint is private and non-cacheable.
It has not been deployed or called against production.


## Admin account role management (staged)

The admin dashboard includes **Manage administrator access**. An existing admin
can look up an existing user profile by exact UID, email, or @nickname, review its
verified Firebase email and UID, and explicitly confirm Grant/Revoke. Editing the
lookup clears the selected account and pending confirmation. There is no
email/username-based automatic admin assignment or self-service promotion.

GET `/api/admin/users/role?q=<identifier>` and PATCH `/api/admin/users/role`
authenticate the caller and resolve current admin authority using the existing
profile role fields and fresh Firebase Authentication claims. PATCH accepts
`{userId, admin, version}`; it rechecks the actor's profile inside the transaction
and fences the target against the version shown during lookup. Responses are
private and non-cacheable. The service needs Firebase Authentication user-read
permission for identity/disabled/custom-claim checks; it never changes custom
claims or provisions accounts.

Grants use the existing `users.role = admin` field. Revocation removes all existing
profile admin variants (`role`, `admin`, `isAdmin`, admin entries in `roles`) while
preserving non-admin roles and unrelated profile/billing data. Existing `updatedAt`
is updated; no new persisted fields or collections are introduced. Role changes
are recorded in structured server logs with actor UID, target UID, and action.

Self-revocation is blocked. Firebase-claim-managed admins and disabled accounts
are read-only in this control and must be managed separately in Firebase.
At least one existing admin (profile role or authentication claim) is needed to
use this page; initial bootstrap remains an operator action. No role grant or
revocation has been performed against production, and this feature is undeployed.
