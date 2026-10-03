#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
region="${GCP_REGION:-us-central1}"
job=collect-intelligence-news-production
case "${INTELLIGENCE_NEWS_COLLECTOR_ENABLED:-0}" in 0|1) ;; *) echo 'INTELLIGENCE_NEWS_COLLECTOR_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
check_maintenance_job_iam "$job"
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 1 --task-timeout 5m --memory 512Mi --cpu 1 \
  --command node --args dist/collect-intelligence-news.cjs,--apply \
  --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID,GIT_SHA=${GIT_SHA:-unknown},INTELLIGENCE_NEWS_COLLECTOR_ENABLED=${INTELLIGENCE_NEWS_COLLECTOR_ENABLED:-0}" --quiet
ensure_maintenance_job_iam "$job"
args=(--project "$GCP_PROJECT_ID" --location "$region" --schedule '0 * * * 1-5' --time-zone America/New_York
  --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run"
  --http-method POST --oauth-service-account-email "$maintenance_scheduler_account" --message-body '{}'
  --attempt-deadline 180s --max-retry-attempts 0 --quiet)
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
  # Preserve an existing operator pause during routine releases.
  gcloud scheduler jobs update http "$job" "${args[@]}"
else
  gcloud scheduler jobs create http "$job" "${args[@]}"
  gcloud scheduler jobs pause "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
fi
