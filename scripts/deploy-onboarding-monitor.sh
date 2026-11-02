#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-ifindata-80905}"
REGION="${REGION:-us-central1}"
JOB=monitor-onboarding-capacity-production
RUNTIME="onboarding-capacity-monitor@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER="directory-sync-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/ifindata/onboarding-capacity-monitor:$(git -C "$ROOT" rev-parse HEAD)"
CONTEXT="$(mktemp -d)"
trap 'rm -rf "$CONTEXT"' EXIT
cp "$ROOT/scripts/monitor-onboarding-capacity.ts" "$CONTEXT/monitor.ts"
cp "$ROOT/Dockerfile.onboarding-monitor" "$CONTEXT/Dockerfile"
# Provision runtime IAM separately: datastore.user, logging.viewer,
# monitoring.viewer, eventarc.viewer, pubsub.viewer. Never disable the guard.
gcloud builds submit "$CONTEXT" --project="$PROJECT_ID" --tag="$IMAGE" --quiet
gcloud run jobs deploy "$JOB" --project="$PROJECT_ID" --region="$REGION" --image="$IMAGE" --service-account="$RUNTIME" --tasks=1 --parallelism=1 --cpu=1 --memory=512Mi --max-retries=0 --task-timeout=120s --quiet
gcloud run jobs add-iam-policy-binding "$JOB" --project="$PROJECT_ID" --region="$REGION" --member="serviceAccount:$SCHEDULER" --role=roles/run.invoker --quiet
ACTION=create
if gcloud scheduler jobs describe "$JOB" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then ACTION=update; fi
gcloud scheduler jobs "$ACTION" http "$JOB" --project="$PROJECT_ID" --location="$REGION" --schedule='* * * * *' --time-zone=America/New_York --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB}:run" --http-method=POST --oauth-service-account-email="$SCHEDULER" --attempt-deadline=180s --quiet
