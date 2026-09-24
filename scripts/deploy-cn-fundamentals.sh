#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE to a built image digest}"
region="${GCP_REGION:-us-central1}"
job="refresh-cn-fundamentals-production"
# Shared maintenance identities; no additional project-level grants.
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
runtime="$maintenance_runtime_account"
trigger="$maintenance_scheduler_account"
# Validate the job name and all three accounts before changing anything.
check_maintenance_job_iam "$job"
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$runtime" --tasks 1 --parallelism 1 \
  --max-retries 1 --task-timeout 20m --memory 1Gi --cpu 1 \
  --command node --args dist/refresh-cn-fundamentals.cjs \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|GIT_SHA=${GIT_SHA:-unknown}" --quiet
# Scheduler and web app (/admin/jobs "Run now") invoker grants on this job.
ensure_maintenance_job_iam "$job"
# Weekdays after the China EOD job (08:00 New York). A new schedule is created
# PAUSED: resume it only after reviewing a dry run (see docs/company-fundamentals.md).
# Updates keep the schedule's current paused/enabled state.
schedule=(--schedule '30 9 * * 1-5' --time-zone America/New_York
  --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run"
  --http-method POST --oauth-service-account-email "$trigger" --message-body '{}'
  --attempt-deadline 180s --max-retry-attempts 1 --quiet)
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$job" --project "$GCP_PROJECT_ID" --location "$region" "${schedule[@]}"
else
  gcloud scheduler jobs create http "$job" --project "$GCP_PROJECT_ID" --location "$region" "${schedule[@]}"
  gcloud scheduler jobs pause "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
fi
