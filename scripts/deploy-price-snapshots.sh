#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${PRICE_SYNC_IMAGE:?Set the immutable price-sync image digest}"
: "${ENTITY_SNAPSHOT_BUCKET:?Set the existing private snapshot bucket}"
[[ "$PRICE_SYNC_IMAGE" == *@sha256:* ]] || { echo 'Image digest required' >&2; exit 1; }
[[ "${PRICE_TIMESTAMP_MIGRATION_COMPLETE:-0}" == 1 ]] || { echo 'Verify price timestamps first' >&2; exit 1; }
region="${GCP_REGION:-us-central1}"
job=sync-price-snapshots-production
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
check_maintenance_job_iam "$job"
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" --image "$PRICE_SYNC_IMAGE" \
 --service-account "$maintenance_runtime_account" --command node --args dist/sync-price-snapshots.cjs \
 --tasks 1 --parallelism 1 --max-retries 0 --task-timeout 30m --memory 4Gi --cpu 1 \
 --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID,ENTITY_SNAPSHOT_BUCKET=$ENTITY_SNAPSHOT_BUCKET,PRICE_TIMESTAMP_MIGRATION_COMPLETE=1,PRICE_SYNC_MAX_READS=${PRICE_SYNC_MAX_READS:-50000},PRICE_SYNC_MAX_PARTITIONS=${PRICE_SYNC_MAX_PARTITIONS:-500},PRICE_SYNC_PAGE_SIZE=1000,PRICE_SYNC_PUBLISH_CONCURRENCY=4,PRICE_SYNC_MAX_DURATION_MS=1200000,NODE_OPTIONS=--max-old-space-size=3072" --quiet
ensure_maintenance_job_iam "$job"
operation=create
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then operation=update; fi
gcloud scheduler jobs "$operation" http "$job" --project "$GCP_PROJECT_ID" --location "$region" --schedule '15 3 * * *' \
 --time-zone America/New_York --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run" \
 --http-method POST --oauth-service-account-email "$maintenance_scheduler_account" --message-body '{}' --attempt-deadline 180s --max-retry-attempts 0 --quiet
