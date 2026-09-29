#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${DIRECTORY_SYNC_IMAGE:?Set DIRECTORY_SYNC_IMAGE}"
region="${GCP_REGION:-us-central1}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
runtime="directory-sync-runtime@$GCP_PROJECT_ID.iam.gserviceaccount.com"
invoker="directory-sync-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com"
service=cni-directory-subscriber
request=cni-directory-requests
dead=cni-directory-dead-letter
subscription=cni-directory-worker
gcloud services enable pubsub.googleapis.com --project "$GCP_PROJECT_ID" --quiet
gcloud beta services identity create --service pubsub.googleapis.com --project "$GCP_PROJECT_ID" --quiet >/dev/null
number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
[[ "$number" =~ ^[0-9]+$ ]] || { echo 'Missing project number' >&2; exit 1; }
agent="service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"
for topic in "$request" "$dead"; do
  if ! gcloud pubsub topics describe "$topic" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud pubsub topics create "$topic" --project "$GCP_PROJECT_ID" --message-storage-policy-allowed-regions "$region" --quiet
  fi
done
for topic in "$request"; do
  gcloud pubsub topics add-iam-policy-binding "$topic" --project "$GCP_PROJECT_ID" --member "serviceAccount:$runtime" --role roles/pubsub.publisher --quiet >/dev/null
done
# Retain failed requests for inspection and replay.
for pair in "$dead:cni-directory-dead-letter-audit"; do
  topic="${pair%%:*}"; sub="${pair#*:}"
  if ! gcloud pubsub subscriptions describe "$sub" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud pubsub subscriptions create "$sub" --topic "$topic" --project "$GCP_PROJECT_ID" --message-retention-duration 7d --expiration-period never --quiet
  fi
done
# One-time setup belongs to an authorized operator, not the release identity.
# Routine releases reuse this binding, also used by the SEC subscriber.
if [[ "${PUBSUB_BOOTSTRAP_IAM:-0}" == 1 ]]; then
  gcloud iam service-accounts add-iam-policy-binding "$invoker" --project "$GCP_PROJECT_ID" \
    --member "serviceAccount:$agent" --role roles/iam.serviceAccountTokenCreator --quiet >/dev/null
fi
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$DIRECTORY_SYNC_IMAGE" --service-account "$runtime" --no-allow-unauthenticated \
  --command node --args dist/serve-cni-directory.cjs --min-instances 0 --max-instances 1 \
  --concurrency 1 --timeout 600 --memory 1Gi --cpu 1 --cpu-throttling \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|GIT_SHA=${GIT_SHA:-unknown}|DIRECTORY_SUBSCRIPTION=$subscription" --quiet
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
