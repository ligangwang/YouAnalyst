#!/usr/bin/env bash
set -euo pipefail
# New resource access is confined to the separately approved, paused setup.
# Routine releases check every binding and resource before changing a revision.
# Approved binding list (all identities already exist):
# earnings-sources-discovered: runtime roles/pubsub.publisher
# earnings-dead-letter: Pub/Sub service agent roles/pubsub.publisher
# earnings-worker: Pub/Sub service agent roles/pubsub.subscriber
# earnings-subscriber: scheduler roles/run.invoker
# collect-earnings-production: scheduler roles/run.invoker
# No web identity grants, project/account IAM, credentials, or Firestore grants.
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"
region="${GCP_REGION:-us-central1}"
runtime="directory-sync-runtime@$GCP_PROJECT_ID.iam.gserviceaccount.com"
scheduler="directory-sync-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com"
job=collect-earnings-production
service=earnings-subscriber
topic=earnings-sources-discovered
dead=earnings-dead-letter
subscription=earnings-worker
audit=earnings-dead-letter-audit
bootstrap="${EARNINGS_BOOTSTRAP_IAM:-0}"
case "${1:-}" in ''|--check) ;; *) echo 'Usage: deploy-earnings.sh [--check]' >&2; exit 1 ;; esac
for flag in EARNINGS_PIPELINE_ENABLED EARNINGS_BOOTSTRAP_IAM EARNINGS_COLLECTION_ENABLED EARNINGS_PROCESSING_ENABLED INTELLIGENCE_NEWS_COLLECTOR_ENABLED; do
  case "${!flag:-0}" in 0|1) ;; *) echo "$flag must be 0 or 1" >&2; exit 1 ;; esac
done
[[ "${EARNINGS_PIPELINE_ENABLED:-0}" == 1 ]] || { echo 'Earnings pipeline is not enabled; approved setup is required.' >&2; exit 1; }
[[ "$GCP_PROJECT_ID" =~ ^[a-z][-a-z0-9]*$ ]] || { echo 'Invalid GCP_PROJECT_ID' >&2; exit 1; }
if [[ "$bootstrap" == 1 ]]; then
  [[ "${GIT_SHA:-}" =~ ^[a-f0-9]{40}$ && "${EARNINGS_SETUP_APPROVED_SHA:-}" == "$GIT_SHA" ]] || {
    echo 'Resource IAM setup requires explicit approval of the exact GIT_SHA using EARNINGS_SETUP_APPROVED_SHA.' >&2; exit 1;
  }
  [[ "${EARNINGS_COLLECTION_ENABLED:-0}" == 0 && "${EARNINGS_PROCESSING_ENABLED:-0}" == 0 ]] || {
    echo 'Earnings setup must keep collection and processing disabled.' >&2; exit 1;
  }
fi
if [[ "${1:-}" != --check ]]; then
  : "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
  [[ "$FUNDAMENTALS_IMAGE" == *@sha256:* ]] || { echo 'Use a pinned fundamentals image digest.' >&2; exit 1; }
fi
number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
[[ "$number" =~ ^[0-9]+$ ]] || { echo 'Missing project number' >&2; exit 1; }
agent="service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"

earnings_iam() {
  local kind="$1" name="$2" role="$3" member="$4" current
  local -a command scope=(--project "$GCP_PROJECT_ID")
  case "$kind" in
    topic) command=(pubsub topics) ;;
    subscription) command=(pubsub subscriptions) ;;
    service) command=(run services); scope+=(--region "$region") ;;
    job) command=(run jobs); scope+=(--region "$region") ;;
    *) echo "Unsupported earnings IAM resource: $kind" >&2; return 1 ;;
  esac
  if [[ "$bootstrap" == 1 ]]; then
    gcloud "${command[@]}" add-iam-policy-binding "$name" "${scope[@]}" --member "$member" --role "$role" --quiet >/dev/null
  else
    current="$(gcloud "${command[@]}" get-iam-policy "$name" "${scope[@]}" \
      --flatten='bindings[].members' --filter="bindings.role=$role AND bindings.members=$member" --format='value(bindings.members)')"
    if ! grep -Fxq -- "$member" <<< "$current"; then
      echo "Missing $role for $member on $kind $name. Routine earnings releases cannot expand IAM; approve the paused setup separately." >&2
      return 1
    fi
  fi
}

earnings_subscription_topic() {
  local name="$1" expected="$2" actual
  if actual="$(gcloud pubsub subscriptions describe "$name" --project "$GCP_PROJECT_ID" --format='value(topic)')"; then
    [[ "$actual" == "projects/$GCP_PROJECT_ID/topics/$expected" ]] || {
      echo "Subscription $name must use projects/$GCP_PROJECT_ID/topics/$expected (got $actual)" >&2; return 1;
    }
  elif [[ "$bootstrap" != 1 ]]; then
    echo "Missing earnings subscription: $name. Run approved paused setup first." >&2; return 1
  fi
}

# Validate existing topic ownership even during setup. Never retarget a name
# belonging to another pipeline. No mutations occur in this preflight.
earnings_subscription_topic "$subscription" "$topic"
earnings_subscription_topic "$audit" "$dead"
if [[ "$bootstrap" != 1 ]]; then
  for name in "$topic" "$dead"; do
    gcloud pubsub topics describe "$name" --project "$GCP_PROJECT_ID" >/dev/null
  done
  gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" >/dev/null
  gcloud run jobs describe "$job" --project "$GCP_PROJECT_ID" --region "$region" >/dev/null
  gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null
  earnings_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$runtime"
  earnings_iam topic "$dead" roles/pubsub.publisher "serviceAccount:$agent"
  earnings_iam subscription "$subscription" roles/pubsub.subscriber "serviceAccount:$agent"
  earnings_iam service "$service" roles/run.invoker "serviceAccount:$scheduler"
  earnings_iam job "$job" roles/run.invoker "serviceAccount:$scheduler"
fi
[[ "${1:-}" == --check ]] && exit 0

earnings_pause_schedule() {
  local state
  gcloud scheduler jobs pause "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
  state="$(gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" --format='value(state)')"
  [[ "$state" == PAUSED ]] || { echo 'Earnings setup did not leave its schedule paused.' >&2; return 1; }
}

if [[ "$bootstrap" == 1 ]]; then
  # An already-existing schedule is paused before any service/job revision changes.
  if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
    earnings_pause_schedule
  fi
  for name in "$topic" "$dead"; do
    if ! gcloud pubsub topics describe "$name" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
      gcloud pubsub topics create "$name" --project "$GCP_PROJECT_ID" --message-storage-policy-allowed-regions "$region" --quiet
    fi
  done
  if ! gcloud pubsub subscriptions describe "$audit" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud pubsub subscriptions create "$audit" --project "$GCP_PROJECT_ID" --topic "$dead" \
      --message-retention-duration 7d --expiration-period never --quiet
  fi
fi

umask 077
env_file="$(mktemp)"
trap 'rm -f -- "$env_file"' EXIT
node -e 'const fs=require("fs"),e=process.env; fs.writeFileSync(process.argv[1],JSON.stringify({GCP_PROJECT_ID:e.GCP_PROJECT_ID,GIT_SHA:e.GIT_SHA||"unknown",SEC_USER_AGENT:e.SEC_USER_AGENT,EARNINGS_TOPIC:"earnings-sources-discovered",EARNINGS_SUBSCRIPTION:"earnings-worker",EARNINGS_COLLECTION_ENABLED:e.EARNINGS_COLLECTION_ENABLED||"0",EARNINGS_PROCESSING_ENABLED:e.EARNINGS_PROCESSING_ENABLED||"0",EARNINGS_CANARY_ONLY:"0",INTELLIGENCE_NEWS_COLLECTOR_ENABLED:e.INTELLIGENCE_NEWS_COLLECTOR_ENABLED||"0"}));' "$env_file"
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$runtime" --no-allow-unauthenticated \
  --command node --args dist/serve-earnings.cjs --min-instances 0 --max-instances 1 \
  --concurrency 1 --timeout 600 --memory 1Gi --cpu 1 --cpu-throttling --env-vars-file "$env_file" --quiet
if [[ "$bootstrap" == 1 ]]; then
  earnings_iam service "$service" roles/run.invoker "serviceAccount:$scheduler"
fi
url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format='value(status.url)')"
[[ "$url" == https://* ]] || { echo 'Missing earnings subscriber URL' >&2; exit 1; }
push_args=(--project "$GCP_PROJECT_ID" --push-endpoint "$url/pubsub"
  --push-auth-service-account "$scheduler" --push-auth-token-audience "$url"
  --ack-deadline 600 --min-retry-delay 300s --max-retry-delay 600s --dead-letter-topic "$dead"
  --max-delivery-attempts 100 --message-retention-duration 7d --expiration-period never --quiet)
if [[ "$bootstrap" == 1 ]] && ! gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud pubsub subscriptions create "$subscription" --topic "$topic" "${push_args[@]}"
else
  gcloud pubsub subscriptions update "$subscription" "${push_args[@]}"
fi
if [[ "$bootstrap" == 1 ]]; then
  earnings_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$runtime"
  earnings_iam topic "$dead" roles/pubsub.publisher "serviceAccount:$agent"
  earnings_iam subscription "$subscription" roles/pubsub.subscriber "serviceAccount:$agent"
fi
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$runtime" --tasks 1 --parallelism 1 \
  --max-retries 0 --task-timeout 20m --memory 1Gi --cpu 1 \
  --command node --args dist/collect-earnings.cjs,--apply --env-vars-file "$env_file" --quiet
if [[ "$bootstrap" == 1 ]]; then
  earnings_iam job "$job" roles/run.invoker "serviceAccount:$scheduler"
fi
schedule_args=(--project "$GCP_PROJECT_ID" --location "$region" --schedule '*/15 * * * *' --time-zone UTC
  --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run"
  --http-method POST --oauth-service-account-email "$scheduler" --message-body '{}'
  --attempt-deadline 180s --max-retry-attempts 1 --quiet)
if [[ "$bootstrap" == 1 ]] && ! gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
  # The collector still has its hard off switch during the create/pause interval.
  gcloud scheduler jobs create http "$job" "${schedule_args[@]}"
else
  # Ordinary updates preserve the existing PAUSED/ENABLED state.
  gcloud scheduler jobs update http "$job" "${schedule_args[@]}"
fi
if [[ "$bootstrap" == 1 ]]; then
  earnings_pause_schedule
fi
