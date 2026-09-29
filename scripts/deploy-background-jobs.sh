#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GIT_SHA:?Set GIT_SHA}"
export GCP_REGION="${GCP_REGION:-us-central1}"
case "${1:-}" in
  all) targets=(sec-fundamentals cn-fundamentals private-valuations ticker-sync directory) ;;
  fundamentals) targets=(sec-fundamentals cn-fundamentals private-valuations ticker-sync) ;;
  sec-fundamentals|cn-fundamentals|private-valuations|ticker-sync|directory) targets=("$1") ;;
  *) echo 'Select all, sec-fundamentals, cn-fundamentals, private-valuations, ticker-sync or directory' >&2; exit 1 ;;
esac
# Validate every selected target before any build or mutation.
for target in "${targets[@]}"; do
  job="refresh-$target-production"
  if [[ "$target" == directory ]]; then job=sync-cni-directory-production; fi
  if [[ "$target" == sec-fundamentals ]]; then : "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"; fi
  WEB_RUNTIME_SERVICE_ACCOUNT="$(bash scripts/lib/maintenance-job-iam.sh --check "$job")"
  export WEB_RUNTIME_SERVICE_ACCOUNT
done
if [[ "$1" != directory ]]; then
  image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/ifindata/sec-fundamentals:$GIT_SHA"
  bash scripts/build-fundamentals.sh "$image"
  FUNDAMENTALS_IMAGE="$(gcloud artifacts docker images describe "$image" --project "$GCP_PROJECT_ID" --format='value(image_summary.fully_qualified_digest)')"
  [[ "$FUNDAMENTALS_IMAGE" == *@sha256:* ]] || { echo 'Missing fundamentals image digest' >&2; exit 1; }
  export FUNDAMENTALS_IMAGE
fi
for target in "${targets[@]}"; do
  if [[ "$target" == directory ]]; then
    image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/ifindata/directory-sync:$GIT_SHA"
    bash scripts/build-fundamentals.sh "$image" cloudbuild.directory-sync.yaml
    image="$(gcloud artifacts docker images describe "$image" --project "$GCP_PROJECT_ID" --format='value(image_summary.fully_qualified_digest)')"
    [[ "$image" == *@sha256:* ]] || { echo 'Missing directory image digest' >&2; exit 1; }
    export DIRECTORY_SYNC_IMAGE="$image"
    bash scripts/deploy-directory-pubsub.sh
    gcloud run jobs update sync-cni-directory-production --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --image "$image" --update-env-vars DIRECTORY_REQUEST_TOPIC=cni-directory-requests --quiet
    bash scripts/lib/maintenance-job-iam.sh sync-cni-directory-production
  else
    bash "scripts/deploy-$target.sh"
  fi
done
