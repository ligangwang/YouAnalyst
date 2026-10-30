#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
[[ "$GCP_PROJECT_ID" =~ ^[a-z][-a-z0-9]*$ ]] || { echo 'Invalid project' >&2; exit 1; }
region="${GCP_REGION:-us-central1}"
subscription=earnings-delivery-checks
topic="projects/$GCP_PROJECT_ID/topics/earnings-sources-discovered"
filter='attributes.type="earnings.delivery.probe"'
url="$(gcloud run services describe earnings-subscriber --project "$GCP_PROJECT_ID" --region "$region" --format='value(status.url)')"
[[ "$url" == https://*.run.app ]] || { echo 'Missing earnings subscriber URL' >&2; exit 1; }
args=(--project "$GCP_PROJECT_ID" --push-endpoint "$url/pubsub"
  --push-auth-service-account "directory-sync-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com"
  --push-auth-token-audience "$url" --ack-deadline 60 --min-retry-delay 1s --max-retry-delay 10s
  --message-retention-duration 1d --expiration-period never --quiet)
if actual="$(gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" --format='value(topic)')"; then
  [[ "$actual" == "$topic" ]] || { echo 'Readiness subscription topic mismatch' >&2; exit 1; }
  actual_filter="$(gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" --format='value(filter)')"
  [[ "${actual_filter//[[:space:]]/}" == "$filter" ]] || { echo 'Readiness subscription filter mismatch' >&2; exit 1; }
  gcloud pubsub subscriptions update "$subscription" "${args[@]}"
else
  # Add a filtered control queue; preserve the source queue, IAM, and schedules.
  gcloud pubsub subscriptions create "$subscription" --topic "$topic" --message-filter "$filter" "${args[@]}"
fi
