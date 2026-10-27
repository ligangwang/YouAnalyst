#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GCP_REGION:?Set GCP_REGION}"
: "${GIT_SHA:?Set GIT_SHA}"
image="${DIRECTORY_SYNC_IMAGE:-}"
if [[ -z "$image" ]]; then
  image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/ifindata/directory-sync:$GIT_SHA"
  bash scripts/build-fundamentals.sh "$image" cloudbuild.directory-sync.yaml
  image="$(gcloud artifacts docker images describe "$image" --project "$GCP_PROJECT_ID" --format='value(image_summary.fully_qualified_digest)')"
fi
[[ "$image" == *@sha256:* ]] || { echo 'Missing directory image digest' >&2; exit 1; }
export DIRECTORY_SYNC_IMAGE="$image"
bash scripts/deploy-directory-pubsub.sh
gcloud run jobs update sync-cni-directory-production --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --image "$image" --update-env-vars DIRECTORY_REQUEST_TOPIC=cni-directory-requests --quiet
bash scripts/lib/maintenance-job-iam.sh sync-cni-directory-production
