#!/usr/bin/env bash
set -euo pipefail
# Called by the manual, exact-main earnings workflow. It changes only earnings
# flags and the earnings schedule; SEC discovery/graph flags are preserved.
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GIT_SHA:?Set GIT_SHA}"
case "${1:-}" in canary|activate|rollback) operation="$1" ;; *) echo 'Usage: operate-earnings.sh canary|activate|rollback' >&2; exit 1 ;; esac
[[ "$GIT_SHA" =~ ^[a-f0-9]{40}$ && "${EARNINGS_OPERATION_APPROVED_SHA:-}" == "$GIT_SHA" ]] || {
  echo 'This earnings operation requires explicit approval of the exact release SHA.' >&2; exit 1;
}
region="${GCP_REGION:-us-central1}"
job=collect-earnings-production
service=earnings-subscriber
sec_job=collect-sec-filings-production
runtime="directory-sync-runtime@$GCP_PROJECT_ID.iam.gserviceaccount.com"
scheduler="directory-sync-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com"
uri="https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run"

read_job() { gcloud run jobs describe "$1" --project "$GCP_PROJECT_ID" --region "$region" --format=json; }
read_service() { gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format=json; }
read_schedule() { gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" --format=json; }
check_schedule() {
  read_schedule | jq -e --arg state "$1" --arg uri "$uri" --arg account "$scheduler" \
    '.state == $state and .httpTarget.uri == $uri and .httpTarget.oauthToken.serviceAccountEmail == $account' >/dev/null
}
job_flag() {
  read_job "$1" | jq -e --arg key EARNINGS_COLLECTION_ENABLED --arg value "$2" \
    '.spec.template.spec.template.spec.containers[0].env | any(.name == $key and .value == $value)' >/dev/null
}
service_flag() {
  read_service | jq -e --arg value "$1" --arg key "${2:-EARNINGS_PROCESSING_ENABLED}" \
    '.spec.template.spec.containers[0].env | any(.name == $key and .value == $value)' >/dev/null
}
sec_contract() {
  # Ignore only the one deliberately changed environment variable. Keep every
  # other SEC setting, container/image/args, resource limit and retry policy.
  jq -cS '.spec.template.spec |
    .template.spec.containers[0].env |= (map(select(.name != "EARNINGS_COLLECTION_ENABLED")) | sort_by(.name))'
}
check_sec_preserved() {
  local current
  current="$(read_job "$sec_job" | sec_contract)"
  [[ "$current" == "$sec_before" ]] || { echo 'The existing SEC collector configuration changed unexpectedly.' >&2; return 1; }
}
execute_mode() {
  # No retry on an uncertain response. Runtime canary/check-canary own the
  # persisted source proof, including exact release SHA and validated records.
  gcloud run jobs execute "$job" --project "$GCP_PROJECT_ID" --region "$region" \
    --args "dist/collect-earnings.cjs,$1" --wait --quiet
}
disable_earnings() {
  local include_sec="$1" failed=0
  gcloud scheduler jobs pause "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet || failed=1
  gcloud run jobs update "$job" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars EARNINGS_COLLECTION_ENABLED=0 --quiet || failed=1
  gcloud run services update "$service" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars EARNINGS_PROCESSING_ENABLED=0,EARNINGS_CANARY_ONLY=0 --quiet || failed=1
  if [[ "$include_sec" == 1 ]]; then
    gcloud run jobs update "$sec_job" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars EARNINGS_COLLECTION_ENABLED=0 --quiet || failed=1
  fi
  check_schedule PAUSED || failed=1
  job_flag "$job" 0 || failed=1
  service_flag 0 || failed=1
  service_flag 0 EARNINGS_CANARY_ONLY || failed=1
  if [[ "$include_sec" == 1 ]]; then job_flag "$sec_job" 0 || failed=1; fi
  if [[ "$failed" != 0 ]]; then
    echo 'Earnings rollback could not be fully verified. Inspect the earnings schedule and flags before any retry.' >&2
  fi
  return "$failed"
}

if [[ "$operation" == rollback ]]; then
  sec_before="$(read_job "$sec_job" | sec_contract)"
  disable_earnings 1
  check_sec_preserved
  echo 'Earnings paused and disabled; existing SEC and graph settings were preserved.'
  exit 0
fi

# Refuse stale revisions, automatic retries, unexpected identities or an active
# schedule before any provider call, flag change or collection execution.
collector="$(read_job "$job")"
worker="$(read_service)"
sec="$(read_job "$sec_job")"
sec_before="$(sec_contract <<< "$sec")"
check_schedule PAUSED
image="$(jq -r '.spec.template.spec.template.spec.containers[0].image' <<< "$collector")"
[[ "$image" == *@sha256:* ]] || { echo 'Earnings collector must use an immutable image digest.' >&2; exit 1; }
jq -e --arg sha "$GIT_SHA" --arg runtime "$runtime" '
  .spec.template.spec as $s | $s.template.spec as $t |
  $t.serviceAccountName == $runtime and $s.taskCount == 1 and $s.parallelism == 1 and $t.maxRetries == 0 and
  $t.containers[0].args == ["dist/collect-earnings.cjs", "--apply"] and
  ($t.containers[0].env | any(.name == "GIT_SHA" and .value == $sha))' <<< "$collector" >/dev/null
jq -e --arg sha "$GIT_SHA" --arg runtime "$runtime" --arg image "$image" '
  .spec.template.spec as $s | $s.serviceAccountName == $runtime and $s.containers[0].image == $image and
  $s.containers[0].args == ["dist/serve-earnings.cjs"] and
  ($s.containers[0].env | any(.name == "GIT_SHA" and .value == $sha))' <<< "$worker" >/dev/null
jq -e --arg sha "$GIT_SHA" --arg runtime "$runtime" '
  .spec.template.spec.template.spec as $s | $s.serviceAccountName == $runtime and
  ($s.containers[0].env | any(.name == "GIT_SHA" and .value == $sha)) and
  ($s.containers[0].env | any(.name == "EARNINGS_COLLECTION_ENABLED" and .value == "0"))' <<< "$sec" >/dev/null
if [[ "$operation" == canary ]]; then
  job_flag "$job" 0
  service_flag 0
  service_flag 0 EARNINGS_CANARY_ONLY
else
  job_flag "$job" 0 || job_flag "$job" 1
  service_flag 0 || service_flag 1
  service_flag 0 EARNINGS_CANARY_ONLY || service_flag 1 EARNINGS_CANARY_ONLY
fi

rollback_sec=0
on_failure() {
  local status="$?"
  trap - EXIT
  if [[ "$status" != 0 ]]; then
    echo 'Earnings operation failed; pausing and disabling earnings before inspection.' >&2
    disable_earnings "$rollback_sec" || true
    check_sec_preserved || true
  fi
  exit "$status"
}
trap on_failure EXIT
if [[ "$operation" == activate ]]; then
  # Read-only durable proof must succeed before activation changes any flag.
  execute_mode --check-canary
fi
execute_mode --verify-delivery
canary_only=0
if [[ "$operation" == canary ]]; then canary_only=1; fi
# One revision sets both flags, so stale unrelated deliveries cannot run during
# a transition into the bounded canary. Normal activation removes this scope.
gcloud run services update "$service" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars "EARNINGS_PROCESSING_ENABLED=1,EARNINGS_CANARY_ONLY=$canary_only" --quiet
gcloud run jobs update "$job" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars EARNINGS_COLLECTION_ENABLED=1 --quiet
service_flag 1
service_flag "$canary_only" EARNINGS_CANARY_ONLY
job_flag "$job" 1
check_schedule PAUSED
if [[ "$operation" == canary ]]; then
  execute_mode --apply,--canary
  check_schedule PAUSED
  service_flag 1 EARNINGS_CANARY_ONLY
  check_sec_preserved
  job_flag "$sec_job" 0
  echo 'Bounded AMD/Longsys canary verified. Earnings schedule remains paused for review.'
else
  rollback_sec=1
  gcloud run jobs update "$sec_job" --project "$GCP_PROJECT_ID" --region "$region" --update-env-vars EARNINGS_COLLECTION_ENABLED=1 --quiet
  check_sec_preserved
  job_flag "$sec_job" 1
  gcloud scheduler jobs resume "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
  check_schedule ENABLED
  job_flag "$job" 1
  service_flag 1
  service_flag 0 EARNINGS_CANARY_ONLY
  check_sec_preserved
  echo 'Earnings collection activated; existing SEC and graph settings were preserved.'
fi
trap - EXIT
