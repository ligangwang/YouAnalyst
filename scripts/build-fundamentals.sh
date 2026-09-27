#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${1:?Pass the fundamentals image tag}"

# Poll the build API instead of streaming the default logs bucket, which the
# deployment identity may not be permitted to read.
build_id="$(gcloud builds submit . --project "$GCP_PROJECT_ID" \
  --config "${2:-cloudbuild.fundamentals.yaml}" --substitutions "_IMAGE=$1" \
  --async --format='value(id)')"
if [[ -z "$build_id" ]]; then
  echo "ERROR: Cloud Build returned no build ID." >&2
  exit 1
fi
echo "Cloud Build: https://console.cloud.google.com/cloud-build/builds/$build_id?project=$GCP_PROJECT_ID"
# Bound the wait even if the API keeps reporting a pending build.
deadline=$((SECONDS + 1500))
while (( SECONDS < deadline )); do
  status="$(gcloud builds describe "$build_id" --project "$GCP_PROJECT_ID" --format='value(status)')"
  echo "Build $build_id: $status"
  case "$status" in
    SUCCESS) exit 0 ;;
    PENDING|QUEUED|WORKING) sleep 10 ;;
    *) echo "ERROR: Build $build_id ended with unexpected or unsuccessful status: $status" >&2; exit 1 ;;
  esac
done
echo "ERROR: Timed out waiting for build $build_id; it may still be running." >&2
exit 1
