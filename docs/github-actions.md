# Deployments and admin tasks

GitHub Actions has one entry point: **Deploy to Cloud Run** (`deploy.yml`). It runs PR checks, deploys the website, then updates affected background workers after a successful production release on `main`.

Worker changes are detected from the pushed commit range. Financial worker changes rebuild their shared image once; directory changes rebuild the directory image. Shared library, dependency or deployment-helper changes update both images. UI-only changes skip workers. A manual production release or an unavailable comparison baseline updates all workers, which also provides a recovery path after a failed worker deployment. Staging releases never deploy production workers.

Deployment validates selected jobs' IAM configuration before building. Financial workers share one build per dispatch; directory uses a separate image. Jobs and subscribers deploy immutable image digests. Deployments serialize through one concurrency group. After an SEC worker deployment, a bounded Pub/Sub delivery probe processes two cached companies without forcing SEC requests; ordinary maintenance is not launched. Existing schedules retain their enabled/paused state; the A-share script creates new schedules paused. Directory deployment provisions its subscriber before updating the publisher, without changing its schedule. Initial directory setup still uses `scripts/deploy-directory-sync.sh`. See [background Pub/Sub jobs](background-pubsub.md) for the full architecture and rollout checklist.

SEC Pub/Sub push authentication requires a one-time `roles/iam.serviceAccountTokenCreator` binding for the Pub/Sub service agent on the scheduler service account. An authorized operator can set `PUBSUB_BOOTSTRAP_IAM=1` when running `scripts/deploy-sec-fundamentals.sh` to create that binding. Routine releases reuse it and do not need service-account IAM administration. The post-deployment cached-company delivery probe verifies that authenticated push delivery still works. If it fails, inspect the subscription and IAM configuration before rerunning; a successful Cloud Run deployment alone is not proof of delivery.

Website presentation libraries live under `src/lib/ui/`, separate from shared data and background processing. Changes there skip worker deployment. CI bundles every entry point declared in both worker Dockerfiles and rejects any direct or transitive dependency on this directory. This includes news, earnings, and maintenance tools. Changes to shared libraries outside the UI directory still rebuild workers. The deployment selector itself contains no worker runtime code and does not trigger worker rebuilds; missing comparison baselines and manual releases retain the full recovery rollout. Retired UI module locations skip workers only while those files remain removed, so this directory migration also avoids an unnecessary rebuild.

## Admin Tasks

Use `/admin/jobs` for routine operations:

| Task | Controls |
| --- | --- |
| US / China EOD | Rerun a selected date |
| SEC / A-share fundamentals | Run background refresh |
| China directory | Run background import |

All controls enforce administrator authorization on the server. Directory dispatch uses the existing `directory_syncs/CN_A_CNI` document and honors the import lease. History and errors come from Cloud Logging; worker status comes from Cloud Run executions.

Admin controls use the current web environment.

## Retired operations

Private valuation jobs and ticker catalog sync, their admin controls, APIs and deployment targets are retired. Production scheduler/job and subscriber resources were removed on 2026-10-14. Existing company, ticker and saved valuation records remain.

Separate worker deployment Actions, ticker-sync and EOD launchers, fixed-batch publication/review Actions and the source-probe Action are retired. Publication scripts, historical data and tests remain for reviewed maintenance. AI analyst generation and draft-review APIs/UI are retired; historical call labels and usage records remain. US/A-share industry research and A-share AI company-profile jobs are retired; their admin APIs return 410. Company directory imports and company-name identity review remain available. Historical GitHub runs are retained.
