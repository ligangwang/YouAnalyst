#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
: "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"
region="${GCP_REGION:-us-central1}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
web_runtime="$(web_runtime_service_account)"
runtime="directory-sync-runtime@$GCP_PROJECT_ID.iam.gserviceaccount.com"
invoker="directory-sync-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com"
service=sec-fundamentals-subscriber
request=sec-fundamentals-requests
result=sec-fundamentals-updates
dead=sec-fundamentals-dead-letter
subscription=sec-fundamentals-worker
gcloud services enable pubsub.googleapis.com --project "$GCP_PROJECT_ID" --quiet
gcloud beta services identity create --service pubsub.googleapis.com --project "$GCP_PROJECT_ID" --quiet >/dev/null
number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
[[ "$number" =~ ^[0-9]+$ ]] || { echo 'Missing project number' >&2; exit 1; }
agent="service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"
for topic in "$request" "$result" "$dead"; do
  if ! gcloud pubsub topics describe "$topic" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud pubsub topics create "$topic" --project "$GCP_PROJECT_ID" --message-storage-policy-allowed-regions "$region" --quiet
  fi
done
for topic in "$request" "$result"; do
  gcloud pubsub topics add-iam-policy-binding "$topic" --project "$GCP_PROJECT_ID" --member "serviceAccount:$runtime" --role roles/pubsub.publisher --quiet >/dev/null
done
# Public page reads may enqueue work, but may not publish results or manage topics.
gcloud pubsub topics add-iam-policy-binding "$request" --project "$GCP_PROJECT_ID" --member "serviceAccount:$web_runtime" --role roles/pubsub.publisher --quiet >/dev/null
# Bounded retention keeps published results available before further consumers
# are introduced; a pull subscription preserves dead letters for inspection.
for pair in "$result:sec-fundamentals-updates-audit" "$dead:sec-fundamentals-dead-letter-audit"; do
  topic="${pair%%:*}"; sub="${pair#*:}"
  if ! gcloud pubsub subscriptions describe "$sub" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud pubsub subscriptions create "$sub" --topic "$topic" --project "$GCP_PROJECT_ID" --message-retention-duration 7d --expiration-period never --quiet
  fi
done
# One-time setup belongs to an authorized operator, not the release identity.
# Routine releases reuse this binding; the delivery probe verifies push auth.
if [[ "${PUBSUB_BOOTSTRAP_IAM:-0}" == 1 ]]; then
  gcloud iam service-accounts add-iam-policy-binding "$invoker" --project "$GCP_PROJECT_ID" \
    --member "serviceAccount:$agent" --role roles/iam.serviceAccountTokenCreator --quiet >/dev/null
fi
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$runtime" --no-allow-unauthenticated \
  --command node --args dist/serve-sec-fundamentals.cjs --min-instances 0 --max-instances 1 \
  --concurrency 1 --timeout 600 --memory 1Gi --cpu 1 --cpu-throttling \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|SEC_USER_AGENT=$SEC_USER_AGENT|GIT_SHA=${GIT_SHA:-unknown}|FUNDAMENTALS_RESULT_TOPIC=$result|FUNDAMENTALS_SUBSCRIPTION=$subscription" --quiet
gcloud run services add-iam-policy-binding "$service" --project "$GCP_PROJECT_ID" --region "$region" \
  --member "serviceAccount:$invoker" --role roles/run.invoker --quiet >/dev/null
url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format='value(status.url)')"
[[ "$url" == https://* ]] || { echo 'Missing subscriber URL' >&2; exit 1; }
args=(--project "$GCP_PROJECT_ID" --push-endpoint "$url/pubsub" --push-auth-service-account "$invoker"
  --push-auth-token-audience "$url" --ack-deadline 600 --min-retry-delay 300s --max-retry-delay 600s
  --dead-letter-topic "$dead" --max-delivery-attempts 100 --message-retention-duration 7d --expiration-period never --quiet)
if gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "$subscription" "${args[@]}"
else
  gcloud pubsub subscriptions create "$subscription" --topic "$request" "${args[@]}"
fi
gcloud pubsub topics add-iam-policy-binding "$dead" --project "$GCP_PROJECT_ID" --member "serviceAccount:$agent" --role roles/pubsub.publisher --quiet >/dev/null
gcloud pubsub subscriptions add-iam-policy-binding "$subscription" --project "$GCP_PROJECT_ID" --member "serviceAccount:$agent" --role roles/pubsub.subscriber --quiet >/dev/null
