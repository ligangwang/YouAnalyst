#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/sec-download-config.sh"
[[ "${SEC_INCREMENTAL_DOWNLOADS_ENABLED:-0}" == 1 ]] || { echo 'Enable SEC incremental downloads explicitly' >&2; exit 1; }
case "${1:-}" in ''|--check) ;; *) echo 'Usage: deploy-sec-downloads.sh [--check]' >&2; exit 1 ;; esac
case "${SEC_DOWNLOAD_BOOTSTRAP_IAM:-0}" in 0|1) ;; *) echo 'Invalid SEC download setup flag' >&2; exit 1 ;; esac
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
export FILING_PIPELINE_BOOTSTRAP_IAM="${SEC_DOWNLOAD_BOOTSTRAP_IAM:-0}"
service=sec-filing-download-subscriber
topic=sec-filing-download-requests
subscription=sec-filing-download-worker
dead=sec-filing-download-dead-letter
job=cleanup-sec-downloads-production
number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
[[ "$number" =~ ^[0-9]+$ ]] || { echo 'Missing project number' >&2; exit 1; }
pipeline_agent="service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"
if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 0 ]]; then
  for name in "$topic" "$dead"; do gcloud pubsub topics describe "$name" --project "$GCP_PROJECT_ID" >/dev/null; done
  pipeline_subscription_topic "$subscription" "$topic"
  pipeline_subscription_topic "$dead-audit" "$dead"
  gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" >/dev/null
  pipeline_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
  pipeline_iam topic sec-filings-discovered roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
  pipeline_iam topic earnings-sources-discovered roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
  pipeline_iam topic "$dead" roles/pubsub.publisher "serviceAccount:$pipeline_agent"
  pipeline_iam subscription "$subscription" roles/pubsub.subscriber "serviceAccount:$pipeline_agent"
  pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
  pipeline_iam job "$job" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
else
  [[ "${1:-}" == --check ]] && exit 0
  # Setup creates only the private cache bucket; no collection or backfill.
  if ! gcloud storage buckets describe "gs://$SEC_DOCUMENT_CACHE_BUCKET" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud storage buckets create "gs://$SEC_DOCUMENT_CACHE_BUCKET" --project "$GCP_PROJECT_ID" --location "$pipeline_region" --uniform-bucket-level-access --public-access-prevention --quiet
  fi
  gcloud storage buckets add-iam-policy-binding "gs://$SEC_DOCUMENT_CACHE_BUCKET" --project "$GCP_PROJECT_ID" --member "serviceAccount:$maintenance_runtime_account" --role roles/storage.objectUser --quiet >/dev/null
fi
# Automatic age-based deletion could violate processing-aware retention. Only
# the bounded cleanup job may delete this prefix after owners complete.
gcloud storage buckets describe "gs://$SEC_DOCUMENT_CACHE_BUCKET" --project "$GCP_PROJECT_ID" --format=json | node -e '
let input="";process.stdin.on("data",d=>input+=d).on("end",()=>{const b=JSON.parse(input),i=b.iamConfiguration;
const uniform=i?.uniformBucketLevelAccess?.enabled??b.uniform_bucket_level_access;
const privacy=i?.publicAccessPrevention??b.public_access_prevention;
const lifecycle=b.lifecycle??b.lifecycle_config;
const rules=Array.isArray(lifecycle)?lifecycle:lifecycle?.rule??[];
if(uniform!==true||privacy!=="enforced"||rules.some(r=>r.action?.type==="Delete"))throw Error("SEC cache must be private, uniform and free of age-only deletion rules");});'
if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 0 ]]; then
  # Storage's get-iam-policy does not accept the generic --filter flag. Inspect
  # its JSON policy and still require the exact unconditional resource binding.
  gcloud storage buckets get-iam-policy "gs://$SEC_DOCUMENT_CACHE_BUCKET" --project "$GCP_PROJECT_ID" --format=json | node -e '
let input="";process.stdin.on("data",d=>input+=d).on("end",()=>{const policy=JSON.parse(input),member="serviceAccount:"+process.argv[1];
if(!Array.isArray(policy.bindings)||!policy.bindings.some(binding=>binding.role==="roles/storage.objectUser"&&!binding.condition&&Array.isArray(binding.members)&&binding.members.includes(member)))throw Error("Missing SEC cache object access");});' "$maintenance_runtime_account"
fi
[[ "${1:-}" == --check ]] && exit 0
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
: "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"
if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 1 ]]; then
  pipeline_topic "$topic"
  pipeline_topic "$dead"
  pipeline_retained_subscription "$subscription" "$topic"
  pipeline_retained_subscription "$dead-audit" "$dead"
  pipeline_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
  pipeline_iam topic sec-filings-discovered roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
  pipeline_iam topic earnings-sources-discovered roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
fi
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --no-allow-unauthenticated \
  --command node --args dist/serve-sec-downloads.cjs --min-instances 0 --max-instances 2 --concurrency 1 --timeout 180 --memory 1Gi --cpu 1 --cpu-throttling \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|ENTITY_SNAPSHOT_BUCKET=${ENTITY_SNAPSHOT_BUCKET:-${EODHD_BULK_EOD_BUCKET:-}}|GIT_SHA=${GIT_SHA:-unknown}|SEC_USER_AGENT=$SEC_USER_AGENT|SEC_DOWNLOAD_SUBSCRIPTION=$subscription$sec_download_env" --quiet
pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format='value(status.url)')"
[[ "$url" == https://* ]] || { echo 'Missing SEC download subscriber URL' >&2; exit 1; }
pipeline_subscription "$subscription" "$topic" "$dead" "$url"
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" \
  --command node --args dist/cleanup-sec-downloads.cjs,--apply --tasks 1 --parallelism 1 --max-retries 0 --task-timeout 10m --memory 512Mi --cpu 1 \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|GIT_SHA=${GIT_SHA:-unknown}$sec_download_env" --quiet
pipeline_iam job "$job" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
pipeline_schedule "$job" '20 * * * *'
