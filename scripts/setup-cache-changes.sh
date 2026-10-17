#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${CACHE_WEB_SERVICE:?Set CACHE_WEB_SERVICE}"
region="${GCP_REGION:-us-central1}"
identity="cache-events@$GCP_PROJECT_ID.iam.gserviceaccount.com"
node scripts/activate-change-cache.mjs --disable
# IAM provisioning is a one-time administrator operation, not a release permission.
if [[ "${CACHE_BOOTSTRAP:-0}" == "1" ]]; then
  gcloud services enable eventarc.googleapis.com eventarcpublishing.googleapis.com pubsub.googleapis.com --project "$GCP_PROJECT_ID" --quiet
  if ! gcloud iam service-accounts describe "$identity" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create cache-events --project "$GCP_PROJECT_ID" --display-name 'Firestore cache change delivery' --quiet
  fi
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member "serviceAccount:$identity" --role roles/eventarc.eventReceiver --condition=None --quiet >/dev/null
  gcloud run services add-iam-policy-binding "$CACHE_WEB_SERVICE" --project "$GCP_PROJECT_ID" --region "$region" --member "serviceAccount:$identity" --role roles/run.invoker --quiet >/dev/null
else
  gcloud iam service-accounts describe "$identity" --project "$GCP_PROJECT_ID" >/dev/null
fi
url="$(gcloud run services describe "$CACHE_WEB_SERVICE" --project "$GCP_PROJECT_ID" --region "$region" --format='value(status.url)')"
[[ "$url" == https://*.run.app ]] || { echo 'Invalid receiver URL' >&2; exit 1; }
gcloud run services update "$CACHE_WEB_SERVICE" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars "CACHE_EVENT_AUDIENCE=$url" --quiet
location="$(gcloud firestore databases describe --database='(default)' --project "$GCP_PROJECT_ID" --format='value(locationId)')"
[[ -n "$location" ]] || { echo 'Missing Firestore location' >&2; exit 1; }
for collection in companies company_relationships company_fundamentals eod_prices corporate_actions earnings_records collectors events users directory_syncs predictions watchlists; do
  trigger="cache-${collection//_/-}"
  if ! gcloud eventarc triggers describe "$trigger" --location "$location" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    [[ "${CACHE_BOOTSTRAP:-0}" == "1" ]] || { echo "Missing cache trigger $trigger; run setup with CACHE_BOOTSTRAP=1 as an administrator" >&2; exit 1; }
    gcloud eventarc triggers create "$trigger" --project "$GCP_PROJECT_ID" --location "$location" \
      --destination-run-service "$CACHE_WEB_SERVICE" --destination-run-region "$region" \
      --destination-run-path /api/internal/cache-changes --service-account "$identity" \
      --event-data-content-type application/protobuf \
      --event-filters 'type=google.cloud.firestore.document.v1.written' \
      --event-filters 'database=(default)' --event-filters-path-pattern "document=$collection/{document}" --quiet
  fi
  gcloud eventarc triggers describe "$trigger" --location "$location" --project "$GCP_PROJECT_ID" --format=json |
    CACHE_SOURCE_COLLECTION="$collection" node scripts/verify-cache-trigger.mjs
done
# Explicit activation only after all receivers exist; reset cached generations on rollout.
# The probe below verifies authenticated delivery before activation.
GCP_PROJECT_ID="$GCP_PROJECT_ID" node scripts/activate-change-cache.mjs
