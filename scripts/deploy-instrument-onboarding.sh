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
  CENTRAL_CACHE_URL:process.env.CENTRAL_CACHE_URL||'',OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_MODEL:process.env.OPENAI_MODEL||'gpt-6-luna',INSTRUMENT_ONBOARDING_MAINTENANCE_READY:'1',THEME_EVIDENCE_FIRST_ENABLED:'1'}),{mode:0o600});
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
serving_revision="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format=json | node -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const active=(JSON.parse(s).status?.traffic||[]).filter(t=>t.percent>0);if(active.length!==1||active[0].percent!==100||!active[0].revisionName)process.exit(1);console.log(active[0].revisionName);});')"
[[ -n "$serving_revision" ]] || { echo 'No stable serving onboarding revision' >&2; exit 1; }
gcloud run services update-traffic "$service" --project "$GCP_PROJECT_ID" --region "$region" --update-tags "prev=$serving_revision" --quiet
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --no-allow-unauthenticated \
  --command node --args dist/serve-instrument-onboarding.cjs --min-instances 0 --max-instances 10 \
  --concurrency 16 --timeout 1200 --memory 1Gi --cpu 1 --cpu-throttling --env-vars-file "$env_file" --no-traffic --tag candidate --quiet
for account in "$invoker" "$maintenance_runtime_account"; do
  gcloud run services add-iam-policy-binding "$service" --project "$GCP_PROJECT_ID" --region "$region" \
    --member "serviceAccount:$account" --role roles/run.invoker --quiet >/dev/null
done
gcloud services enable eventarc.googleapis.com eventarcpublishing.googleapis.com --project "$GCP_PROJECT_ID" --quiet
# Project IAM is operator-bootstrapped with setup-instrument-onboarding.sh;
# the routine deployment identity cannot modify project permissions.
location="$(gcloud firestore databases describe --database='(default)' --project "$GCP_PROJECT_ID" --format='value(locationId)')"
[[ -n "$location" ]] || { echo 'Firestore location required' >&2; exit 1; }
# Keep the serving revision and every existing schedule/subscription in place.
gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format=json | node -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
const v=JSON.parse(s);if(!v.status?.conditions?.some(c=>c.type==="Ready"&&c.status==="True"))process.exit(1);
});'
gcloud eventarc triggers describe "$trigger" --location "$location" --project "$GCP_PROJECT_ID" --format=json | node -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
const v=JSON.parse(s),run=v.destination?.cloudRun;if(!v.transport?.pubsub?.subscription||Object.keys(v.conditions||{}).length||run?.service!==process.argv[1]||run?.region!==process.argv[2]||run?.path!=="/events")process.exit(1);
});' "$service" "$region"
candidate="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format=json)"
candidate_url="$(printf '%s' "$candidate" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const t=JSON.parse(s).status.traffic.find(t=>t.tag==="candidate");if(!t?.url)process.exit(1);console.log(t.url);});')"
candidate_revision="$(printf '%s' "$candidate" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const t=JSON.parse(s).status.traffic.find(t=>t.tag==="candidate");if(!t?.revisionName)process.exit(1);console.log(t.revisionName);});')"
service_url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format='value(status.url)')"
[[ "$candidate_url" == https://*.run.app && "$service_url" == https://*.run.app && "$candidate_revision" != "$serving_revision" ]] || { echo 'Invalid onboarding candidate' >&2; exit 1; }
# Later delivery checks execute the job without overrides, so retain its normal URL.
gcloud run jobs update "$job" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars "ONBOARDING_SUBSCRIBER_URL=$service_url" --quiet
# Exercise the exact candidate without changing the job's stored environment.
gcloud run jobs execute "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --args dist/onboard-instruments.cjs,--verify-delivery --update-env-vars "ONBOARDING_SUBSCRIBER_URL=$candidate_url,ONBOARDING_SUBSCRIBER_AUDIENCE=$service_url" --wait --quiet
# Do not route production messages to a revision without a live safety monitor.
gcloud run jobs execute "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --args dist/onboard-instruments.cjs,--verify-capacity --wait --quiet
gcloud run services update-traffic "$service" --project "$GCP_PROJECT_ID" --region "$region" --to-revisions "$candidate_revision=100" --quiet
