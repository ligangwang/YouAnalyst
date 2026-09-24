#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${DIRECTORY_SYNC_IMAGE:?Set DIRECTORY_SYNC_IMAGE to a built image digest}"
region="${GCP_REGION:-us-central1}"
job="sync-cni-directory-production"
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
runtime="$maintenance_runtime_account"
trigger="$maintenance_scheduler_account"
# Resolve before changing anything so a missing web account fails the deploy early.
WEB_RUNTIME_SERVICE_ACCOUNT="$(web_runtime_service_account)"
for account in directory-sync-runtime directory-sync-scheduler; do
  gcloud iam service-accounts describe "${account}@${GCP_PROJECT_ID}.iam.gserviceaccount.com" --project "$GCP_PROJECT_ID" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$account" --project "$GCP_PROJECT_ID"
done
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member "serviceAccount:$runtime" --role roles/datastore.user --condition=None --quiet >/dev/null
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" --image "$DIRECTORY_SYNC_IMAGE" --service-account "$runtime" --tasks 1 --parallelism 1 --max-retries 1 --task-timeout 20m --memory 1Gi --cpu 1 --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID" --quiet
# Scheduler and web app (/admin/jobs "Run now") invoker grants on this job.
ensure_maintenance_job_iam "$job"
operation=create
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then operation=update; fi
gcloud scheduler jobs "$operation" http "$job" --project "$GCP_PROJECT_ID" --location "$region" --schedule '20 2 * * 1' --time-zone UTC --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run" --http-method POST --oauth-service-account-email "$trigger" --message-body '{}' --attempt-deadline 180s --max-retry-attempts 1 --quiet
