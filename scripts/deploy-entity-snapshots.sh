#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${FUNDAMENTALS_IMAGE:?Set the built maintenance image digest}"
: "${ENTITY_SNAPSHOT_BUCKET:?Set an existing private Cloud Storage bucket}"
[[ "$FUNDAMENTALS_IMAGE" == *@sha256:* ]] || { echo 'Image must be pinned by digest' >&2; exit 1; }
[[ "${ENTITY_TIMESTAMP_MIGRATION_COMPLETE:-0}" == 1 ]] || { echo 'Verify the updatedAt migration first' >&2; exit 1; }
region="${GCP_REGION:-us-central1}"
job="sync-entity-snapshots-production"
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
check_maintenance_job_iam "$job"
# Reuse private storage; never make entity data public or create new collections.
gcloud storage buckets describe "gs://$ENTITY_SNAPSHOT_BUCKET" --project "$GCP_PROJECT_ID" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$ENTITY_SNAPSHOT_BUCKET" --project "$GCP_PROJECT_ID" --member "serviceAccount:$maintenance_runtime_account" --role roles/storage.objectUser --quiet >/dev/null
# The shared maintenance runtime already has Firestore access provisioned during
# setup. Routine releases must not require project-wide IAM administration.
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --command node --args dist/sync-entity-snapshots.cjs --tasks 1 --parallelism 1 --max-retries 0 --task-timeout 30m --memory 4Gi --cpu 1 --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID,ENTITY_SNAPSHOT_BUCKET=$ENTITY_SNAPSHOT_BUCKET,ENTITY_TIMESTAMP_MIGRATION_COMPLETE=1,NODE_OPTIONS=--max-old-space-size=3072" --quiet
ensure_maintenance_job_iam "$job"
operation=create
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then operation=update; fi
gcloud scheduler jobs "$operation" http "$job" --project "$GCP_PROJECT_ID" --location "$region" --schedule '0 3 * * *' --time-zone America/New_York --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run" --http-method POST --oauth-service-account-email "$maintenance_scheduler_account" --message-body '{}' --attempt-deadline 180s --max-retry-attempts 0 --quiet
