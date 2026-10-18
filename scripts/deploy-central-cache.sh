#!/usr/bin/env bash
set -euo pipefail
# Deploy a private candidate only. Do not enable CENTRAL_CACHE_URL on callers until
# timestamp-capable writers are deployed and the collectors tombstone index is ready.
# If a candidate was warmed before the new receiver was live, create a fresh
# revision after writer/receiver rollout and in-flight legacy delivery drain.
# Never enable callers against a pre-rollout snapshot: deletes may be missing.
# Existing revisions keep serving; candidate promotion is a separate verified step.
: "${GCP_PROJECT_ID:?}"
: "${CACHE_IMAGE:?Use an immutable image digest}"
: "${CACHE_RUNTIME_ACCOUNT:?Existing least-privilege Firestore reader service account}"
[[ "$CACHE_IMAGE" == *@sha256:* ]] || { echo 'Immutable image digest required' >&2; exit 1; }
region="${GCP_REGION:-us-central1}"
service="${CACHE_SERVICE:-youanalyst-memory-cache}"
traffic=(--no-traffic)
# First creation has no existing callers and Cloud Run rejects --no-traffic.
if [[ "${CACHE_INITIAL_CREATE:-0}" == 1 ]]; then traffic=(); fi
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$CACHE_IMAGE" --service-account "$CACHE_RUNTIME_ACCOUNT" \
  --no-allow-unauthenticated --cpu 1 --memory 1Gi --min-instances 1 \
  --max-instances 1 --concurrency 20 --cpu-throttling --timeout 60 \
  --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID" \
  --startup-probe 'httpGet.path=/health,httpGet.port=8080,periodSeconds=10,timeoutSeconds=5,failureThreshold=24' \
  "${traffic[@]}" --tag cache-candidate --quiet
# Grant roles/run.invoker only to the website/worker identities, never allUsers.
# Verify /health, counts, representative selectors and memory against Firestore.
# Promote that exact ready revision, then enable clients gradually. Leave the old
# cache revision alive through the transition; durable deletion markers catch it up.
echo 'Candidate created. Traffic and caller configuration have not been changed.'
