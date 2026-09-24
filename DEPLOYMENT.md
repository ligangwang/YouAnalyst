# Deployment

## Firebase email action links

`/__/auth/action` now forwards complete email action links to the configured
project's `firebaseapp.com/__/auth/action` handler. Firebase validates expired or
used codes and handles password reset, verification and email recovery. The
route preserves language and tenant parameters, uses the configured project/key,
and only retains HTTPS continuations on `youanalyst.com`. It sends no-store,
no-referrer and noindex headers and renders no application analytics. A bare
URL shows bilingual guidance rather than attempting an account action.

This is a handoff to Firebase's hosted UI, not a same-origin replacement for
that UI; users still need connectivity to Firebase. Email templates must include
their normal mode and oobCode parameters. No email templates or account settings
are changed by this deployment. Test with `npm run test:auth`; do not log real
email-action URLs/codes or consume production codes during smoke tests.

## Same-origin email authentication

Email signup, password login, persisted-user lookup and token refresh use
`/api/firebase-auth/*` on the current website origin. The server forwards only
allowlisted Firebase REST endpoints, using the existing Firebase project key.
Existing accounts and Firebase ID tokens are preserved. Do not change
`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to the website domain for this fix; that setting
controls OAuth widgets, not the email/password REST endpoint.

Run `npm run test:auth` (requires Playwright Chromium), `npm run typecheck` and
`npm run build`. The browser regression uses mocked Firebase responses and verifies
signup, refresh, reload and login make no external-domain requests.

After deployment, test with a disposable account on a mainland China connection:
register, reload, sign out/in and force a token refresh. Confirm all email-auth
requests use the website origin. Verify the production Firebase key's referrer
restrictions accept the website origin and monitor Firebase signup quotas, since
upstream requests now originate from the server. Exclude these routes and their
credential/token bodies from CDN caching and request/response-body logging.

Google popup login still needs Google connectivity. If Firebase reCAPTCHA
Enterprise enforcement is enabled for email/password, its browser challenge can
still need external Google resources; this proxy does not bypass that challenge.
Real production connectivity, quota settings and reCAPTCHA configuration are not
covered by the mocked regression.

The goal is a fast, safe loop:

1. Build locally.
2. Publish to a staging Cloud Run service.
3. Smoke-test `/api/health`.
4. Promote to production when the feature is ready.

## Recommended Agile Flow

For day-to-day iteration:

```bash
npm run smoke:install
npm run verify
npm run deploy:staging
```

That staging deploy command will:

1. Deploy Firestore indexes from `firestore.indexes.json`.
2. Run Firestore graph migrations.
3. Run lint, typecheck, and production build.
4. Build and push the container with Cloud Build.
5. Deploy to the staging Cloud Run service.
6. Fetch the deployed service URL.
7. Call `/api/health` and fail if the app is not healthy.

If you want local browser smoke coverage too:

```bash
PLAYWRIGHT_RUN_SMOKE=1 npm run deploy:staging
```

That will run the Playwright smoke suite against the deployed Cloud Run URL after the health check succeeds.

When the feature is confirmed in staging:

```bash
npm run deploy:production
```

## Prerequisites

- Google Cloud project with billing enabled
- Cloud Run, Cloud Build, and Artifact Registry APIs enabled
- Cloud Firestore API enabled (`firestore.googleapis.com`)
- Default Firestore database created (`(default)`, Native mode)
- `gcloud` installed and authenticated
- Artifact Registry repository created once

Enable Firestore API once per project:

```bash
gcloud services enable firestore.googleapis.com --project "$GOOGLE_CLOUD_PROJECT"
```

Create Firestore database once per project (if not already created):

```bash
gcloud firestore databases create \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --database="(default)" \
  --location=us-central1 \
  --type=firestore-native
```

Optional deploy behavior:

- `FIRESTORE_PROJECT_ID` can be set when Firestore lives in a different project than Cloud Run.
- Set `APPLY_FIRESTORE_INDEXES=0` to skip automatic index deployment.

Index deployment is applied via `gcloud firestore indexes composite create` from `scripts/firestore/apply-indexes.ts` to avoid requiring Firebaserules API permissions in CI.

Firestore project resolution order:

1. `FIRESTORE_PROJECT_ID`
2. `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
3. `GOOGLE_CLOUD_PROJECT`

Create the repository once:

```bash
gcloud artifacts repositories create ifindata \
  --repository-format=docker \
  --location=us-central1
```

## Local Environment Variables

Before using the deploy scripts, export:

```bash
export GOOGLE_CLOUD_PROJECT=your-gcp-project-id
export GOOGLE_CLOUD_REGION=us-central1
export CLOUD_RUN_SERVICE_STAGING=ifindata-web-staging
export CLOUD_RUN_SERVICE_PRODUCTION=ifindata-web
```

Optional:

```bash
export APP_ENVIRONMENT=staging
```

## CI/CD Recommendation

- Push to `dev`: auto-deploy to staging.
- Push to `main`: auto-deploy to production only when you are comfortable with that cadence.
- For stricter control, keep production on manual workflow dispatch.

This repository is set up for:

- fast local staging deploys
- GitHub Actions staging deployment on `dev`
- GitHub Actions production deployment on `main` or manual dispatch
- post-deploy Playwright smoke checks in CI

## Health Check

The app exposes `/api/health` and returns environment, revision, and commit metadata when available. Use it as the first smoke test after every deployment.

## Runtime Variables

Set Cloud Run environment variables for:

- `NEXT_PUBLIC_*` Firebase client configuration
- Stripe secrets
- Neo4j credentials
- `APP_ENVIRONMENT`
- `GIT_SHA` if you want deploy metadata in the health endpoint

## Scheduled Jobs

The deploy workflow can provision Cloud Scheduler HTTP jobs after a successful Cloud Run deploy. These jobs call internal endpoints with `INTERNAL_API_TOKEN`, so keep that secret configured in each GitHub environment before enabling schedules.

EOD maintenance is controlled by:

- `EOD_MAINTENANCE_SCHEDULER_ENABLED` (`1` to upsert, otherwise skipped)
- `EOD_MAINTENANCE_SCHEDULER_JOB`
- `EOD_MAINTENANCE_SCHEDULER_LIMIT`
- `EOD_MAINTENANCE_SCHEDULER_DRY_RUN`

Insider transaction and institutional holdings ingestion have been retired. Their scheduler provisioning and internal endpoints have been removed.

## IAM For Migrations

The identity used by deploy (for example the service account in `GCP_SA_KEY`) must be able to read/write Firestore documents for graph migrations.

Minimum recommended role on the target project:

```bash
gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:YOUR_DEPLOY_SA@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

To confirm which principal CI is using, inspect the `gcloud auth list` output in the deploy workflow logs.

## Recurring maintenance on Google Cloud

Routine maintenance belongs in Cloud Scheduler, not GitHub Actions. The directory
sync uses Cloud Run Job `sync-cni-directory-production` in `us-central1`, triggered
Monday at 02:20 UTC. US EOD maintenance runs Monday–Friday at 8 PM New York
time; China A-share EOD maintenance runs Monday–Friday at 8 AM New York time.
Both HTTP schedules use `America/New_York`, following its daylight-saving changes.
The China schedule replaces the previous 8 PM and 11 PM Shanghai runs.

Build `Dockerfile.directory-sync` with `cloudbuild.directory-sync.yaml` and an
`_IMAGE` substitution. Provision using `scripts/deploy-directory-sync.sh` with
`GCP_PROJECT_ID`, `GCP_REGION`, and `DIRECTORY_SYNC_IMAGE` set to the built digest.
The dedicated runtime identity requires `roles/datastore.user`; the scheduler
identity receives `roles/run.invoker` only on this job. The job has one task,
a 20-minute timeout, and a 30-minute lease on existing document
`directory_syncs/CN_A_CNI`. Snapshot completion preserves the lease; failed partial
imports are safe to replay. No new Firestore collection is used.

Verify a successful execution and its source snapshot before retiring the old
GitHub schedule. Cancel any waiting old workflow runs during the cutover.
The replacement GitHub `Deploy directory sync job` workflow is manual and deploys
an image only; it never performs the directory import.

### SEC fundamentals queue

Company pages read cached SEC fundamentals and deduplicate missing/expired cache
requests on the existing `company_fundamentals/{ticker}` documents. They never
download SEC filings. Queue fields include `pending`, `requestedAt`, `refreshAfter`,
`lastAttemptAt`, `outcome` and sanitized `lastError`; successful refreshes merge
into the same document, preserving request history. No new collection is used.

Cloud Scheduler triggers `refresh-sec-fundamentals-production` daily at 21:00
`America/New_York`. Build `Dockerfile.fundamentals` using
`cloudbuild.fundamentals.yaml`, then provision with
`scripts/deploy-sec-fundamentals.sh`. The script requires `GCP_PROJECT_ID`,
`FUNDAMENTALS_IMAGE` and the existing `SEC_USER_AGENT` contact setting. It reuses
the directory maintenance runtime/scheduler identities; invocation is scoped to
the new job. The GitHub deployment workflow is manual, with no maintenance cron.

Each run reads the same full graph as the website, queues all missing or expired
US map companies (including ADRs), and audits that each has a cache or request
record. `_worker` in `company_fundamentals` holds the shared lease and latest
coverage summary. Overlapping executions are rejected; a later attempt of the
same Cloud Run task can recover its predecessor's lease. A run processes up to
500 requests or 18 minutes under a 20-minute timeout, retaining all remaining
requests for the next run. Requests are sequential, spaced at least 500 ms apart.

Provider failures preserve prior data and pending requests with a one-hour
cooldown; HTTP 403/429 stops the batch. Failed/deferred-error requests make the
execution fail instead of silently reporting success. Unmapped tickers or missing
annual reports retain an explicit unavailable result/request history and retry
after seven days. These are reported separately from cached financials.
Use `--seed-only` to queue/audit the map without contacting SEC. Inspect structured
logs with `jsonPayload.job="refresh-sec-fundamentals"`, and verify the job execution
itself: a successful Scheduler invocation only means the execution was started.

### A-share fundamentals job

`refresh-cn-fundamentals-production` stores official A-share share counts and
CNY/USD market caps in existing `company_fundamentals/{XSHG|XSHE:code}`
documents (see docs/company-fundamentals.md). It uses the same image as the SEC
job (`Dockerfile.fundamentals` bundles both workers) and runs
`node dist/refresh-cn-fundamentals.cjs`. Provision it with the manual
**Deploy A-share fundamentals job** workflow (`scripts/deploy-cn-fundamentals.sh`),
which needs only `GCP_PROJECT_ID` and the built image: no API keys (FX and prices
are read from Firestore). It reuses the directory maintenance runtime/scheduler
identities, and invocation is scoped to the new job.

The script creates the Cloud Scheduler job (weekdays 09:30 `America/New_York`,
after the 08:00 China EOD job) **paused**, and later deploys keep its current
state. Before enabling it:

1. Run the dry run (no Firestore writes) and spot-check a few companies:
   `gcloud run jobs execute refresh-cn-fundamentals-production --region us-central1 --args=dist/refresh-cn-fundamentals.cjs,--dry-run --wait`
2. Confirm cninfo and SSE were reachable from Cloud Run (no `cn_request_failed`
   events for `www.cninfo.com.cn` or `query.sse.com.cn`). SZSE is a best-effort
   cross-check and was unreachable from US networks when this was built.
3. As for the SEC job, grant the web runtime `run.jobs.run` on this job (for
   **Run now**); history reads use its existing Logging/Cloud Run permissions.
4. Resume: `gcloud scheduler jobs resume refresh-cn-fundamentals-production --location us-central1`.

`_cn_worker` in `company_fundamentals` holds the shared lease, provider cooldowns
and the last run summary; overlapping executions are rejected and a retry of the
same Cloud Run task recovers its predecessor's lease. Per-company leases, 1-second
request spacing, 6-hour retry and provider cooldowns, and kept-on-failure data
follow the SEC job's design. Provider and format failures (including HTTP 200
error bodies and schema changes) keep the published count and market cap; the
execution exits non-zero when more than 2 companies fail, a valuation write fails
or the batch cannot finish. Validated unavailable outcomes never fail it. Filter logs
with `jsonPayload.job="refresh-cn-fundamentals"` and a `jsonPayload.runId`;
request failures are `jsonPayload.event="cn_request_failed"`. The Scheduled Jobs
admin page lists its executions and offers **Run A-share fundamentals now**
(admin-only POST `/api/admin/jobs/cn-fundamentals`, with the same 2-minute
dispatch guard as the SEC button, stored on `_cn_worker`).

The read-only **Probe A-share share-count sources** workflow re-checks source
reachability and parsing from a GitHub-hosted runner for any list of codes.

### EOD and directory diagnostics

Every ordinary US price-loading run unions all US-listed companies from the live
AI industry map with the prediction tickers. Map coverage does not depend on the
prediction scan limit or whether a company has any predictions; newly published
map companies and US-listed ADRs are included automatically. Explicit manual ticker
repairs and mark-only runs retain their requested scope. Ordinary China runs
likewise union every Shanghai/Shenzhen map company with the prediction tickers,
so A-share market caps have stored closes; an empty A-share map fails the run.
Only a valid price for the exact ticker, market and run date counts as a cache hit.
The existing `eod_prices` collection stores fetched prices. `map_price_coverage`
logs and `eod_runs.priceLoad.mapCoverage` report requested, cached, fetched and
missing map tickers, and the terminal result includes provider failure reasons.
Unavailable provider prices remain visible as coverage errors; they are never
silently counted as fetched. An unavailable or empty US graph fails the run rather
than silently falling back to prediction-only coverage.

In Cloud Logging, filter `jsonPayload.job="daily-eod-maintenance"` or
`jsonPayload.job="sync-cni-directory"`. Each invocation has a `runId`; EOD records
also persist it as `eod_runs.logRunId`. Filter `jsonPayload.error.contention=true`
for contention failures, then use the same `jsonPayload.runId` to see all stages.
Transaction logs distinguish callback retries from successful commits and record
document paths, prediction ID, last operation, attempts, revision and elapsed time.
Error stacks and codes are retained with API query tokens and bearer credentials
redacted. Document bodies are never recorded by transaction instrumentation.
EOD processing semantics and retry policy are unchanged; this instrumentation does
not itself resolve contention. Failure-status write errors no longer hide the
original exception. No notification channel or alert policy is created by this change.

### Admin scheduled-job history

Admins can select a US or China EOD job, choose a date and use **Rerun for this date**.
The authenticated POST validates a real calendar date in the market timezone,
rejects future dates and non-EOD jobs, and runs the existing maintenance function
with the normal 500-prediction limit. It reuses valid final prices and does not
force score recomputation or roll forward into other dates. Manual run logs
include `trigger=admin` and `requestedBy`; the response returns the run ID and
price/result counts. The page refreshes its paginated history after completion.
A shared 30-minute lease in existing `eod_runs/_active_US` or `_active_CN_A`
documents prevents overlapping scheduled/manual mutations for the same market.
Completed calls release their lease; crashes expire automatically. A conflict
returns HTTP 409. After a browser/network interruption, inspect history before
retrying because the server may still be processing the request.

Open `/admin/jobs` (linked from the admin dashboard). All five production maintenance jobs have run history, results, errors/warnings, per-run logs and scheduler deliveries. Each view uses provider cursors with Previous/Next pagination, at most 20 entries per page. A Logging scan can return an empty page with a next cursor; Next remains available. Result joins only query run IDs on the current page and follow at most three bounded result pages; incomplete lookups show Unknown and a warning, never false success.

Cloud Run Jobs supply authoritative execution status for SEC fundamentals, A-share fundamentals and directory imports, including startup failures and cancellations. EOD runs join structured start/result/error logs by run ID and market; older runs without structured start logs are still visible through scheduler deliveries. Manual maintenance invocations can also appear. A scheduler delivery means its HTTP target accepted the request, not that a Cloud Run Job succeeded. Runs without a completion record become unconfirmed after one hour. Optional failures and warnings remain available in the error view even when a run succeeds.

The backend reads existing Cloud Logging and Cloud Run APIs through ADC, using `GCP_PROJECT_ID` (or `NEXT_PUBLIC_FIREBASE_PROJECT_ID`) and `GCP_REGION` (default `us-central1`). Runtime permissions must include `logging.logEntries.list`, `logging.logs.list`, and `run.executions.list` for these jobs. History reads need no write access; manual EOD reruns use the existing maintenance Firestore permissions. No new Firestore collection is needed. Production's existing runtime identity already has these permissions. User requests require verified Firebase authentication and the existing admin-role check; responses are private/no-store and log credentials are redacted.

Log history follows the existing `_Default` bucket's 30-day retention; execution availability follows Cloud Run's retention. A later successful retry does not erase earlier log entries. Results and error details are not copied into a new storage system.

### Generic graph membership

Company graph metadata is now written to `companies.inGraph` (the same membership object previously stored in `aiGraph`, not a boolean). Readers query both published fields during the transition, deduplicate company IDs, and prefer `inGraph` when both exist. Existing legacy records remain usable without an immediate rewrite; import/publish replays copy their reviewed metadata into `inGraph`. No new collection is required. Separate industry views will still require graph identifiers and filtering.

### Estimated market capitalization

The SEC fundamentals job recalculates market caps after draining its SEC queue,
including companies whose SEC cache remains fresh. It reads the latest dated US
price already in `eod_prices` using the existing document-ID index; it does not
fetch prices. Results are stored as `company_fundamentals/{ticker}.marketCap` and
returned with cached fundamentals. No new collection is created.

Values are estimates in USD, with price date, closing price, share-count date,
filing date, SEC source, and calculation timestamp. The worker uses instantaneous
`dei:EntityCommonStockSharesOutstanding`, never weighted-average EPS shares.
Foreign annual filers, multiple/unknown ticker mappings, conflicting shares,
share counts older than 180 days or newer than the price, and detected later
split disclosures yield an unavailable reason. Corporate actions not yet reported
to SEC can still make estimates differ from vendor market caps. Separate ADR and
multi-class support requires verified share ratios/class coverage.

The job reserves two minutes of its existing deadline for these cache-only
calculations. Per-company failures are logged, and terminal summaries include
estimated/unavailable/failed counts and incomplete status. Deployment requires
both the web release and the manual `Deploy SEC fundamentals job` workflow; the
next scheduled execution populates the new fields as SEC snapshots refresh.

The Scheduled Jobs admin page also offers **Run SEC fundamentals now**. Its
admin-authenticated POST endpoint starts only the configured SEC Cloud Run job
(no arbitrary job, command, environment or date overrides). It returns HTTP 202
once Cloud Run accepts the request. The existing worker document stores a
2-minute dispatch guard and the requesting admin ID; active worker leases reject
additional manual starts. Cloud Run POST retries are disabled because an ambiguous
response may already have created an execution. Refresh history to inspect status.
The web runtime needs `run.jobs.run` on this job. Normal worker freshness and SEC
cooldowns still apply; ready legacy caches missing share metadata are upgraded
once, even inside their previous freshness window.
