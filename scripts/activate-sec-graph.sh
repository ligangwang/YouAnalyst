#!/usr/bin/env bash
set -euo pipefail
# An approval is bound to the reviewed source tree, not a movable branch or flag.
# Later ordinary releases preserve rollout settings without repeating activation.
tree="$(git rev-parse 'HEAD^{tree}')"
if [[ -z "${SEC_GRAPH_ACTIVATE_TREE:-}" || "$SEC_GRAPH_ACTIVATE_TREE" != "$tree" ]]; then
  echo 'SEC/graph activation is not requested for this source tree.'
  exit 0
fi
[[ "$tree" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid reviewed source tree' >&2; exit 1; }
[[ "${ENABLE_SEC_FILING_PIPELINE:-0}" == 1 && "${COMPANY_GRAPH_PROCESSING_ENABLED:-0}" == 1 && "${SEC_FILINGS_COLLECTOR_ENABLED:-0}" == 1 ]] || {
  echo 'SEC/graph activation requires the reviewed pipeline and both processing flags.' >&2; exit 1;
}
[[ "${COMPANY_GRAPH_QUEUE_BATCH_SIZE:-1}" == 1 ]] || { echo 'Initial graph activation requires batch size 1.' >&2; exit 1; }
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GIT_SHA:?Set GIT_SHA}"
[[ "$GIT_SHA" == "$(git rev-parse HEAD)" ]] || { echo 'Release commit does not match checkout.' >&2; exit 1; }
region="${GCP_REGION:-us-central1}"
[[ "$GCP_PROJECT_ID" == ifindata-80905 && "$region" == us-central1 ]] || { echo 'Activation target is outside the approved production project/region.' >&2; exit 1; }
image_repository="$region-docker.pkg.dev/$GCP_PROJECT_ID/ifindata/sec-fundamentals"
image="$(gcloud artifacts docker images describe "$image_repository:$GIT_SHA" --project "$GCP_PROJECT_ID" --format='value(image_summary.fully_qualified_digest)')"
[[ "$image" == "$image_repository"@sha256:* && "$image" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Reviewed release image digest unavailable.' >&2; exit 1; }
jobs=(refresh-company-graph-production collect-sec-filings-production)
crons=('*/5 * * * *' '*/15 * * * *')

# Read only the existing resources. No create/update or IAM fallback is permitted.
for i in 0 1; do
  gcloud scheduler jobs describe "${jobs[$i]}" --project "$GCP_PROJECT_ID" --location "$region" --format=json |
    jq -e --arg cron "${crons[$i]}" --arg uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/${jobs[$i]}:run" \
      '(.state == "PAUSED" or .state == "ENABLED") and .schedule == $cron and .timeZone == "UTC" and .httpTarget.uri == $uri and .httpTarget.httpMethod == "POST"' >/dev/null
done
check_job() {
  local job="$1" key="$2" value="$3"
  gcloud run jobs describe "$job" --project "$GCP_PROJECT_ID" --region "$region" --format=json |
    jq -e --arg sha "$GIT_SHA" --arg key "$key" --arg value "$value" --arg image "$image" --arg project "$GCP_PROJECT_ID" --arg account "directory-sync-runtime@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
      '.spec.template.spec.template.spec as $s | ($s.containers[0].env | map({key:.name,value:.value}) | from_entries) as $e |
       $s.serviceAccountName == $account and $s.containers[0].image == $image and $e.GIT_SHA == $sha and $e.GCP_PROJECT_ID == $project and $e[$key] == $value' >/dev/null
}
check_job refresh-company-graph-production COMPANY_GRAPH_QUEUE_BATCH_SIZE 1
check_job collect-sec-filings-production SEC_FILINGS_COLLECTOR_ENABLED 1
for service in company-graph-subscriber sec-fundamentals-subscriber; do
  gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format=json |
    jq -e --arg sha "$GIT_SHA" --arg service "$service" --arg image "$image" --arg project "$GCP_PROJECT_ID" \
      '(.spec.template.spec.containers[0].env | map({key:.name,value:.value}) | from_entries) as $e |
       .status.latestReadyRevisionName as $ready | $e.GIT_SHA == $sha and $e.GCP_PROJECT_ID == $project and
       .spec.template.spec.containers[0].image == $image and
       ($service != "company-graph-subscriber" or ($e.COMPANY_GRAPH_PROCESSING_ENABLED == "1" and $e.OPENAI_MODEL == "gpt-5.6-sol")) and
       .status.latestCreatedRevisionName == $ready and any(.status.traffic[]; .revisionName == $ready and .percent == 100)' >/dev/null
done

pause_schedules() {
  local failed=0
  for job in "${jobs[@]}"; do
    gcloud scheduler jobs pause "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet || failed=1
  done
  return "$failed"
}
# If verification or either resume fails, leave both existing schedules paused.
# The saved marker makes a retry reuse the same provider request and filing event.
activated=0
cleanup() {
  local status=$?
  if [[ "$activated" != 1 ]]; then
    if ! pause_schedules; then echo 'ERROR: Could not confirm both schedules paused; operator action required.' >&2; fi
  fi
  return "$status"
}
trap cleanup EXIT
pause_schedules
execution="$(gcloud run jobs execute refresh-company-graph-production \
  --project "$GCP_PROJECT_ID" --region "$region" \
  --args dist/refresh-company-graph.cjs,--verify-live \
  --update-env-vars "COMPANY_GRAPH_VERIFY_ONLY=0,SEC_GRAPH_ACTIVATION_TREE=$tree,SEC_GRAPH_RELEASE_SHA=$GIT_SHA" --wait --quiet --format='value(metadata.name)')"
[[ "$execution" =~ ^refresh-company-graph-production-[a-z0-9]+$ ]] || { echo 'Activation execution identity unavailable; inspect before retrying.' >&2; exit 1; }
gcloud run jobs executions describe "$execution" --project "$GCP_PROJECT_ID" --region "$region" --format=json |
  jq -e --arg execution "$execution" --arg image "$image" --arg sha "$GIT_SHA" --arg tree "$tree" --arg project "$GCP_PROJECT_ID" \
    '.spec.template.spec.containers[0] as $c | ($c.env | map({key:.name,value:.value}) | from_entries) as $e |
     .metadata.name == $execution and $c.image == $image and $c.command == ["node"] and
     $c.args == ["dist/refresh-company-graph.cjs", "--verify-live"] and
     $e.GIT_SHA == $sha and $e.GCP_PROJECT_ID == $project and $e.SEC_GRAPH_RELEASE_SHA == $sha and $e.SEC_GRAPH_ACTIVATION_TREE == $tree and
     $e.COMPANY_GRAPH_VERIFY_ONLY == "0" and .spec.taskCount == 1 and
     any(.status.conditions[]; .type == "Completed" and .status == "True") and
     .status.succeededCount == 1 and (.status.failedCount // 0) == 0 and
     (.status.cancelledCount // 0) == 0 and (.status.runningCount // 0) == 0' >/dev/null
for job in "${jobs[@]}"; do
  gcloud scheduler jobs resume "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
done
for job in "${jobs[@]}"; do
  [[ "$(gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" --format='value(state)')" == ENABLED ]]
done
activated=1
echo 'Verified capped NVDA graph extraction and exact filing fan-out; both existing schedules are enabled.'
