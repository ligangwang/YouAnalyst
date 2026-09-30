#!/usr/bin/env bash
set -euo pipefail

project_id="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT is required}"
region="${GOOGLE_CLOUD_REGION:-us-central1}"
bucket="${MUSIC_STORAGE_BUCKET:?MUSIC_STORAGE_BUCKET is required}"
service="${MUSIC_WEB_SERVICE:?MUSIC_WEB_SERVICE is required}"
[[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,220}[a-z0-9]$ ]] || { echo 'Invalid media bucket name' >&2; exit 1; }

description_error="$(mktemp)"
trap 'rm -f "$description_error"' EXIT
if ! gcloud storage buckets describe "gs://$bucket" --project "$project_id" >/dev/null 2>"$description_error"; then
  if ! grep -Eq '404|[Nn]ot [Ff]ound|does not exist' "$description_error"; then
    cat "$description_error" >&2
    exit 1
  fi
  gcloud storage buckets create "gs://$bucket" --project "$project_id" --location "$region" \
    --uniform-bucket-level-access --public-access-prevention --quiet
fi

runtime_account="${WEB_RUNTIME_SERVICE_ACCOUNT:-}"
if [[ -z "$runtime_account" ]]; then
  runtime_account="$(gcloud run services describe "$service" --project "$project_id" --region "$region" --format='value(spec.template.spec.serviceAccountName)')"
fi
if [[ -z "$runtime_account" ]]; then
  echo 'Cannot determine the web runtime service account for media storage.' >&2
  exit 1
fi
gcloud storage buckets add-iam-policy-binding "gs://$bucket" --project "$project_id" \
  --member="serviceAccount:$runtime_account" --role=roles/storage.objectUser --quiet >/dev/null
echo "Music storage ready: $bucket"
