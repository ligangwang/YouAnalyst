#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${EODHD_API_TOKEN:?Reuse the existing EODHD credential}"
: "${EODHD_BULK_EOD_BUCKET:?Set the existing private EODHD bucket}"
region="${GCP_REGION:-us-central1}"
job=onboard-instruments-production
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
check_maintenance_job_iam "$job"
if [[ "${1:-}" == --check ]]; then exit 0; fi
: "${FUNDAMENTALS_IMAGE:?Set the reviewed shared worker image digest}"
[[ "$FUNDAMENTALS_IMAGE" == *@sha256:* ]] || { echo 'Pinned image digest required' >&2; exit 1; }
env_file="$(mktemp)"
chmod 600 "$env_file"
trap 'rm -f "$env_file"' EXIT
node - "$env_file" <<'NODE'
const fs=require('node:fs');
fs.writeFileSync(process.argv[2],JSON.stringify({GCP_PROJECT_ID:process.env.GCP_PROJECT_ID,GIT_SHA:process.env.GIT_SHA,
  EODHD_API_TOKEN:process.env.EODHD_API_TOKEN,EODHD_API_URL:process.env.EODHD_API_URL||'',EODHD_BULK_EOD_BUCKET:process.env.EODHD_BULK_EOD_BUCKET,
  CENTRAL_CACHE_URL:process.env.CENTRAL_CACHE_URL||'',INSTRUMENT_ONBOARDING_MAINTENANCE_READY:'1'}),{mode:0o600});
NODE
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 0 --task-timeout 20m --memory 1Gi --cpu 1 \
  --command node --args dist/onboard-instruments.cjs,--process,--limit=1 --env-vars-file "$env_file" --quiet
ensure_maintenance_job_iam "$job"
# One checkpoint per execution; the durable request owns deduplication/retries.
# Updates preserve the existing schedule state, without pausing other work.
args=(--project "$GCP_PROJECT_ID" --location "$region" --schedule '*/5 * * * *' --time-zone America/New_York
  --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run"
  --http-method POST --oauth-service-account-email "$maintenance_scheduler_account" --message-body '{}'
  --attempt-deadline 180s --max-retry-attempts 1 --quiet)
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$job" "${args[@]}"
else
  gcloud scheduler jobs create http "$job" "${args[@]}"
fi
