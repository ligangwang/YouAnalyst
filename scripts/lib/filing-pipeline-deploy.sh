#!/usr/bin/env bash
# Deployment helpers for the explicitly enabled SEC filing pipeline. No IAM is
# expanded by an ordinary release: an authorized operator must opt into bootstrap.
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
pipeline_region="${GCP_REGION:-us-central1}"
source "$(dirname "${BASH_SOURCE[0]}")/maintenance-job-iam.sh"

pipeline_require_enabled() {
  case "${PUBSUB_BOOTSTRAP_IAM:-0}" in 0|1) ;; *) echo 'PUBSUB_BOOTSTRAP_IAM must be 0 or 1' >&2; return 1 ;; esac
  case "${FILING_PIPELINE_BOOTSTRAP_IAM:-0}" in 0|1) ;; *) echo 'FILING_PIPELINE_BOOTSTRAP_IAM must be 0 or 1' >&2; return 1 ;; esac
  [[ "${ENABLE_SEC_FILING_PIPELINE:-0}" == 1 ]] || {
    echo 'SEC filing pipeline is not enabled. Review docs/background-pubsub.md before setting ENABLE_SEC_FILING_PIPELINE=1.' >&2
    return 1
  }
}

# Existing subscriptions cannot be retargeted with update. Refuse a name/topic
# mismatch rather than silently claiming that fan-out is wired correctly.
pipeline_subscription_topic() {
  local subscription="$1" topic="$2" actual
  actual="$(gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" --format='value(topic)')" || return 1
  [[ "$actual" == "projects/$GCP_PROJECT_ID/topics/$topic" ]] || {
    echo "Subscription $subscription must use projects/$GCP_PROJECT_ID/topics/$topic (got $actual)" >&2
    return 1
  }
}

pipeline_retained_subscription() {
  local subscription="$1" topic="$2"
  if gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    pipeline_subscription_topic "$subscription" "$topic"
  else
    gcloud pubsub subscriptions create "$subscription" --topic "$topic" --project "$GCP_PROJECT_ID" \
      --message-retention-duration 7d --expiration-period never --quiet
  fi
}

pipeline_iam() {
  local kind="$1" name="$2" role="$3" member="$4" current
  local bootstrap="${FILING_PIPELINE_BOOTSTRAP_IAM:-${PUBSUB_BOOTSTRAP_IAM:-0}}"
  local -a command scope=(--project "$GCP_PROJECT_ID")
  case "$kind" in
    topic) command=(pubsub topics) ;;
    subscription) command=(pubsub subscriptions) ;;
    service) command=(run services); scope+=(--region "$pipeline_region") ;;
    job) command=(run jobs); scope+=(--region "$pipeline_region") ;;
    account) command=(iam service-accounts); bootstrap="${PUBSUB_BOOTSTRAP_IAM:-0}" ;;
    *) echo "Unknown IAM resource kind: $kind" >&2; return 1 ;;
  esac
  if [[ "$bootstrap" == 1 ]]; then
    gcloud "${command[@]}" add-iam-policy-binding "$name" "${scope[@]}" \
      --member "$member" --role "$role" --quiet >/dev/null
  else
    # Exact role/member checks, never a broad project-level permission grant.
    current="$(gcloud "${command[@]}" get-iam-policy "$name" "${scope[@]}" \
      --flatten='bindings[].members' --filter="bindings.role=$role AND bindings.members=$member" \
      --format='value(bindings.members)')" || return 1
    if ! grep -Fxq -- "$member" <<< "$current"; then
      echo "Missing $role for $member on $kind $name. An authorized operator must approve the setup workflow or FILING_PIPELINE_BOOTSTRAP_IAM=1; PUBSUB_BOOTSTRAP_IAM=1 additionally administers shared account IAM. Routine releases cannot expand IAM." >&2
      return 1
    fi
  fi
}

pipeline_topic() {
  local topic="$1"
  if ! gcloud pubsub topics describe "$topic" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud pubsub topics create "$topic" --project "$GCP_PROJECT_ID" \
      --message-storage-policy-allowed-regions "$pipeline_region" --quiet
  fi
}

pipeline_delivery_identity() {
  local number
  number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
  [[ "$number" =~ ^[0-9]+$ ]] || { echo 'Missing project number' >&2; return 1; }
  pipeline_agent="service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"
  # Reuse the established SEC push identity binding without requiring the
  # release principal to read service-account IAM (the live probe checks auth).
  # Only a separately approved bootstrap may administer this account binding.
  if [[ "${PUBSUB_BOOTSTRAP_IAM:-0}" == 1 ]]; then
    pipeline_iam account "$maintenance_scheduler_account" roles/iam.serviceAccountTokenCreator "serviceAccount:$pipeline_agent"
  fi
}

pipeline_subscription() {
  local subscription="$1" topic="$2" dead="$3" url="$4"
  pipeline_topic "$dead"
  pipeline_retained_subscription "$dead-audit" "$dead"
  local -a args=(--project "$GCP_PROJECT_ID" --push-endpoint "$url/pubsub"
    --push-auth-service-account "$maintenance_scheduler_account" --push-auth-token-audience "$url"
    --ack-deadline 600 --min-retry-delay 300s --max-retry-delay 600s --dead-letter-topic "$dead"
    --max-delivery-attempts 100 --message-retention-duration 7d --expiration-period never --quiet)
  if gcloud pubsub subscriptions describe "$subscription" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    pipeline_subscription_topic "$subscription" "$topic"
    gcloud pubsub subscriptions update "$subscription" "${args[@]}"
  else
    gcloud pubsub subscriptions create "$subscription" --topic "$topic" "${args[@]}"
  fi
  pipeline_iam topic "$dead" roles/pubsub.publisher "serviceAccount:$pipeline_agent"
  pipeline_iam subscription "$subscription" roles/pubsub.subscriber "serviceAccount:$pipeline_agent"
}

pipeline_job_invokers() {
  local job="$1"
  pipeline_iam job "$job" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
  pipeline_iam job "$job" roles/run.invoker "serviceAccount:$WEB_RUNTIME_SERVICE_ACCOUNT"
}

pipeline_schedule() {
  local job="$1" cron="$2"
  local -a args=(--project "$GCP_PROJECT_ID" --location "$pipeline_region" --schedule "$cron" --time-zone UTC
    --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$pipeline_region/jobs/$job:run"
    --http-method POST --oauth-service-account-email "$maintenance_scheduler_account" --message-body '{}'
    --attempt-deadline 180s --max-retry-attempts 1 --quiet)
  if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$pipeline_region" >/dev/null 2>&1; then
    # update preserves the operator's existing PAUSED/ENABLED state.
    gcloud scheduler jobs update http "$job" "${args[@]}"
  else
    gcloud scheduler jobs create http "$job" "${args[@]}"
    gcloud scheduler jobs pause "$job" --project "$GCP_PROJECT_ID" --location "$pipeline_region" --quiet
  fi
}
