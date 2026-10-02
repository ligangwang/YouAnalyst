#!/usr/bin/env bash
set -euo pipefail
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
: "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
pipeline_require_enabled
job=collect-sec-filings-production
check_maintenance_job_iam "$job"
# Both fan-out consumers must exist before a collector can publish events.
for subscription in sec-filings-fundamentals company-graph-filings; do
  pipeline_subscription_topic "$subscription" sec-filings-discovered
done
# The collector is disabled by default independently of schedule state. An
# operator must deliberately enable it after inspecting its read-only plan.
case "${SEC_FILINGS_COLLECTOR_ENABLED:-0}" in 0|1) ;; *) echo 'SEC_FILINGS_COLLECTOR_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
for flag in EARNINGS_PIPELINE_ENABLED EARNINGS_COLLECTION_ENABLED; do
  case "${!flag:-0}" in 0|1) ;; *) echo "$flag must be 0 or 1" >&2; exit 1 ;; esac
done
# Observe the existing SEC poller's raw discoveries; never start another poller.
earnings_collection=0
if [[ "${EARNINGS_PIPELINE_ENABLED:-0}" == 1 ]]; then earnings_collection="${EARNINGS_COLLECTION_ENABLED:-0}"; fi
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$pipeline_region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 1 --task-timeout 20m --memory 1Gi --cpu 1 \
  --command node --args dist/collect-sec-filings.cjs,--apply \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|GIT_SHA=${GIT_SHA:-unknown}|SEC_USER_AGENT=$SEC_USER_AGENT|SEC_FILINGS_TOPIC=sec-filings-discovered|SEC_FILINGS_COLLECTOR_ENABLED=${SEC_FILINGS_COLLECTOR_ENABLED:-0}|EARNINGS_COLLECTION_ENABLED=$earnings_collection" --quiet
pipeline_job_invokers "$job"
pipeline_schedule "$job" '*/15 * * * *'
