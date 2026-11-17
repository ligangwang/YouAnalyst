#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
export ENTITY_SNAPSHOT_BUCKET="${ENTITY_SNAPSHOT_BUCKET:-${EODHD_BULK_EOD_BUCKET:-}}"
: "${ENTITY_SNAPSHOT_BUCKET:?Set ENTITY_SNAPSHOT_BUCKET or EODHD_BULK_EOD_BUCKET for Parquet company reads}"
gcloud storage buckets describe "gs://$ENTITY_SNAPSHOT_BUCKET" --project "$GCP_PROJECT_ID" >/dev/null
case "${1:-}" in ''|--check) ;; *) echo 'Usage: deploy-cn-discovery.sh [--check]' >&2; exit 1 ;; esac
case "${CN_DISCOVERY_BOOTSTRAP_IAM:-0}" in 0|1) ;; *) echo 'CN_DISCOVERY_BOOTSTRAP_IAM must be 0 or 1' >&2; exit 1 ;; esac
case "${EARNINGS_COLLECTION_ENABLED:-0}" in 0|1) ;; *) echo 'Invalid earnings collection flag' >&2; exit 1 ;; esac
case "${CN_DISCOVERY_QUEUE_ENABLED:-0}" in 0|1) ;; *) echo 'Invalid A-share discovery flag' >&2; exit 1 ;; esac
max_instances="${CN_DISCOVERY_MAX_INSTANCES:-4}"
[[ "$max_instances" =~ ^([1-9]|1[0-9]|20)$ ]] || { echo 'CN_DISCOVERY_MAX_INSTANCES must be 1 through 20' >&2; exit 1; }
# Reuse established resource-scoped IAM and subscription/topic validation helpers.
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
export FILING_PIPELINE_BOOTSTRAP_IAM="${CN_DISCOVERY_BOOTSTRAP_IAM:-0}"
service=cn-company-discovery-subscriber
topic=cn-company-discovery-requests
subscription=cn-company-discovery-worker
dead=cn-company-discovery-dead-letter
number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
[[ "$number" =~ ^[0-9]+$ ]] || { echo 'Missing project number' >&2; exit 1; }
pipeline_agent="service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"

if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 1 ]]; then
  # Setup may create missing resources, but cannot reuse another pipeline's name.
  if gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then pipeline_subscription_topic "$subscription" "$topic"; fi
  if gcloud pubsub subscriptions describe "$dead-audit" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then pipeline_subscription_topic "$dead-audit" "$dead"; fi
fi
if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 0 ]]; then
  # Fail before building or replacing the publisher if setup is incomplete.
  for name in "$topic" "$dead"; do gcloud pubsub topics describe "$name" --project "$GCP_PROJECT_ID" >/dev/null; done
  pipeline_subscription_topic "$subscription" "$topic"
  pipeline_subscription_topic "$dead-audit" "$dead"
  gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" >/dev/null
  pipeline_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
  pipeline_iam topic "$dead" roles/pubsub.publisher "serviceAccount:$pipeline_agent"
  pipeline_iam subscription "$subscription" roles/pubsub.subscriber "serviceAccount:$pipeline_agent"
  pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
fi
[[ "${1:-}" == --check ]] && exit 0
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 1 ]]; then
  pipeline_topic "$topic"
  pipeline_topic "$dead"
  pipeline_retained_subscription "$subscription" "$topic"
  pipeline_retained_subscription "$dead-audit" "$dead"
  pipeline_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
fi
# Company point reads initialize the shared SQLite directory and watermark cache.
# The default ~512 MiB V8 heap exhausted during warmup and replayed Pub/Sub work.
# Keep native/SQLite headroom outside the explicitly bounded JavaScript heap.
suffix="r${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}-${RANDOM}"
revision="$service-$suffix"
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --no-allow-unauthenticated \
  --command node --args dist/serve-cn-discovery.cjs --min-instances 0 --max-instances "$max_instances" \
  --concurrency 10 --timeout 600 --memory 2Gi --cpu 1 --cpu-throttling \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|NODE_OPTIONS=--max-old-space-size=1536|GIT_SHA=${GIT_SHA:-unknown}|ENTITY_SNAPSHOT_BUCKET=$ENTITY_SNAPSHOT_BUCKET|CN_DISCOVERY_SUBSCRIPTION=$subscription|CN_DISCOVERY_QUEUE_ENABLED=${CN_DISCOVERY_QUEUE_ENABLED:-0}|EARNINGS_COLLECTION_ENABLED=${EARNINGS_COLLECTION_ENABLED:-0}|CENTRAL_CACHE_URL=${CENTRAL_CACHE_URL:-}" \
  --revision-suffix "$suffix" --no-traffic --tag candidate --quiet
pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
export DISCOVERY_RELEASE_REVISION="$revision" DISCOVERY_RELEASE_IMAGE="$FUNDAMENTALS_IMAGE"
export DISCOVERY_RELEASE_ACCOUNT="$maintenance_runtime_account" DISCOVERY_RELEASE_BUNDLE=serve-cn-discovery
gcloud run revisions describe "$revision" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format=json | node scripts/verify-discovery-revision.mjs revision
candidate_url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format=json | node scripts/verify-discovery-revision.mjs candidate)"
url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format='value(status.url)')"
[[ "$url" == https://* ]] || { echo 'Missing A-share subscriber URL' >&2; exit 1; }
token="$(gcloud auth print-identity-token --audiences="$url")"
[[ "$(curl --fail --silent --show-error --retry 3 --retry-all-errors --retry-delay 2 --max-time 30 -H "Authorization: Bearer $token" "$candidate_url/health")" == ok ]]
unset token
gcloud run services update-traffic "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --to-revisions "$revision=100" --quiet
gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format=json | node scripts/verify-discovery-revision.mjs traffic
pipeline_subscription "$subscription" "$topic" "$dead" "$url"
