# Deployments and admin tasks

GitHub Actions has one entry point: **Deploy to Cloud Run** (`deploy.yml`). It runs PR checks, deploys the website, then updates affected background workers after a successful production release on `main`.

Worker changes are detected from the pushed commit range. Financial worker changes rebuild their shared image once; directory changes rebuild the directory image. Shared library, dependency or deployment-helper changes update both images. UI-only changes skip workers. A manual production release or an unavailable comparison baseline updates all workers, which also provides a recovery path after a failed worker deployment. Staging releases never deploy production workers.

Deployment validates selected jobs' IAM configuration before building. The three financial workers share one build per dispatch; directory uses a separate image. Jobs deploy immutable image digests. Deployments serialize through one concurrency group. After an SEC worker deployment, a bounded Pub/Sub delivery probe processes two cached companies without forcing SEC requests; ordinary maintenance is not launched. Existing schedules retain their enabled/paused state; the A-share script creates new schedules paused. Directory deployment updates an existing worker and IAM without changing its schedule. Initial directory setup still uses `scripts/deploy-directory-sync.sh`.

SEC Pub/Sub push authentication requires a one-time `roles/iam.serviceAccountTokenCreator` binding for the Pub/Sub service agent on the scheduler service account. An authorized operator can set `PUBSUB_BOOTSTRAP_IAM=1` when running `scripts/deploy-sec-fundamentals.sh` to create that binding. Routine releases reuse it and do not need service-account IAM administration. The post-deployment cached-company delivery probe verifies that authenticated push delivery still works. If it fails, inspect the subscription and IAM configuration before rerunning; a successful Cloud Run deployment alone is not proof of delivery.

Chart layout and tour libraries are excluded from worker triggers only when they are absent from every worker bundle. A deployment test checks the exclusion list against the bundled dependencies so future imports cannot silently bypass a needed worker update.

## Admin Tasks

Use `/admin/jobs` for routine operations:

| Task | Controls |
| --- | --- |
| US / China EOD | Rerun a selected date |
| SEC / A-share fundamentals | Run background refresh |
| Private valuations | Run background check |
| China directory | Run background import |
| Ticker catalog | Preview or sync, with country, currency, types and optional limit |

All controls enforce administrator authorization on the server. Directory dispatch uses the existing `directory_syncs/CN_A_CNI` document and honors the import lease. Ticker sync uses `directory_syncs/TICKER_CATALOG` for its execution lease; no new collection is created. History and errors come from Cloud Logging; worker status comes from Cloud Run executions.

Ticker preview does not write catalog records. Ticker sync runs during the HTTP request; keep the page open until results appear. A failed or interrupted request can have committed some batches: inspect history before retrying. The provider request has a 30-second timeout. Ticker sync has no schedule. Admin controls use the current web environment. Existing internal maintenance APIs remain available for deliberate operations; advanced EOD recomputation and cross-date roll-forward remain outside the admin UI.

## Retired operations

Separate worker deployment Actions, ticker-sync and EOD launchers, fixed-batch publication/review Actions and the source-probe Action are retired. Publication scripts, historical data and tests remain for reviewed maintenance. AI analyst generation and draft-review APIs/UI are retired; historical call labels and usage records remain. Company/industry research review continues through existing admin tools. Historical GitHub runs are retained.
