#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${EODHD_API_TOKEN:?Reuse the existing EODHD credential}"
: "${EODHD_BULK_EOD_BUCKET:?Set the existing private EODHD bucket}"
: "${OPENAI_API_KEY:?Reuse the approved existing OpenAI credential}"
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
  CENTRAL_CACHE_URL:process.env.CENTRAL_CACHE_URL||'',OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_MODEL:process.env.OPENAI_MODEL||'gpt-6-luna',INSTRUMENT_ONBOARDING_MAINTENANCE_READY:'1'}),{mode:0o600});
NODE
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 0 --task-timeout 20m --memory 1Gi --cpu 1 \
  --command node --args dist/onboard-instruments.cjs,--process,--limit=1 --env-vars-file "$env_file" --quiet
ensure_maintenance_job_iam "$job"
# Requests and checkpoint updates are the durable event source. No publisher gap,
# polling, schema additions, or scheduler is needed.
service=instrument-onboarding-subscriber
trigger=instrument-onboarding-requests
invoker="$maintenance_scheduler_account"
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --no-allow-unauthenticated \
  --command node --args dist/serve-instrument-onboarding.cjs --min-instances 0 --max-instances 2 \
  --concurrency 1 --timeout 1200 --memory 1Gi --cpu 1 --cpu-throttling --env-vars-file "$env_file" --quiet
for account in "$invoker" "$maintenance_runtime_account"; do
  gcloud run services add-iam-policy-binding "$service" --project "$GCP_PROJECT_ID" --region "$region" \
    --member "serviceAccount:$account" --role roles/run.invoker --quiet >/dev/null
done
gcloud services enable eventarc.googleapis.com eventarcpublishing.googleapis.com --project "$GCP_PROJECT_ID" --quiet
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member "serviceAccount:$invoker" --role roles/eventarc.eventReceiver --quiet >/dev/null
location="$(gcloud firestore databases describe --database='(default)' --project "$GCP_PROJECT_ID" --format='value(locationId)')"
[[ -n "$location" ]] || { echo 'Firestore location required' >&2; exit 1; }
if gcloud eventarc triggers describe "$trigger" --location "$location" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud eventarc triggers update "$trigger" --location "$location" --project "$GCP_PROJECT_ID" \
    --destination-run-service "$service" --destination-run-region "$region" --destination-run-path /events --service-account "$invoker" --quiet
else
  gcloud eventarc triggers create "$trigger" --location "$location" --project "$GCP_PROJECT_ID" \
    --destination-run-service "$service" --destination-run-region "$region" --destination-run-path /events \
    --event-filters 'type=google.cloud.firestore.document.v1.written' --event-filters 'database=(default)' \
    --event-filters 'namespace=(default)' --event-filters-path-pattern 'document=instrument_onboarding_requests/{instrumentId}' \
    --event-data-content-type application/protobuf --service-account "$invoker" --quiet
fi
# Only retire this specific polling schedule after its replacement is ready.
# Do not cancel active executions or change any other schedule/subscription.
gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format=json | node -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
const v=JSON.parse(s);if(!v.status?.conditions?.some(c=>c.type==="Ready"&&c.status==="True"))process.exit(1);
});'
gcloud eventarc triggers describe "$trigger" --location "$location" --project "$GCP_PROJECT_ID" --format=json | node -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
const v=JSON.parse(s);if(!v.transport?.pubsub?.subscription||Object.keys(v.conditions||{}).length)process.exit(1);
});'
url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format='value(status.url)')"
[[ "$url" == https://*.run.app ]] || { echo 'Invalid subscriber URL' >&2; exit 1; }
gcloud run jobs update "$job" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars "ONBOARDING_SUBSCRIBER_URL=$url" --quiet
# Exercise authenticated routing and current-state lookup without creating a request.
gcloud run jobs execute "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --args dist/onboard-instruments.cjs,--verify-delivery --wait --quiet
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
  gcloud scheduler jobs delete "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
fi
