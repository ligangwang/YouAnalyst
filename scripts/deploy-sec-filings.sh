#!/usr/bin/env bash
set -euo pipefail
case "${SEC_DISCOVERY_QUEUE_ENABLED:-0}" in 0|1) ;; *) echo 'Invalid SEC discovery queue flag' >&2; exit 1 ;; esac
export ENTITY_SNAPSHOT_BUCKET="${ENTITY_SNAPSHOT_BUCKET:-${EODHD_BULK_EOD_BUCKET:-}}"
: "${ENTITY_SNAPSHOT_BUCKET:?Set ENTITY_SNAPSHOT_BUCKET or EODHD_BULK_EOD_BUCKET for SQLite company reads}"
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
: "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
pipeline_require_enabled
source "$(dirname "${BASH_SOURCE[0]}")/lib/sec-download-config.sh"
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
filing_topic=sec-filings-discovered
schedule='*/15 * * * *'
if [[ "${SEC_INCREMENTAL_DOWNLOADS_ENABLED:-0}" == 1 ]]; then
  consumers=(sec-fundamentals-subscriber company-graph-subscriber)
  if [[ "$earnings_collection" == 1 ]]; then consumers+=(earnings-subscriber); fi
  for consumer in "${consumers[@]}"; do
    gcloud run services describe "$consumer" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format=json | node -e '
let input="";process.stdin.on("data",d=>input+=d).on("end",()=>{const service=JSON.parse(input),env=Object.fromEntries((service.spec?.template?.spec?.containers?.[0]?.env??[]).map(item=>[item.name,item.value]));
const ready=service.status?.latestReadyRevisionName,active=(service.status?.traffic??[]).filter(row=>row.percent>0);
if(!ready||ready!==service.status.latestCreatedRevisionName||active.reduce((sum,row)=>sum+row.percent,0)!==100||active.some(row=>row.revisionName!==ready&&!row.latestRevision)||env.SEC_INCREMENTAL_DOWNLOADS_ENABLED!=="1"||env.SEC_DOCUMENT_CACHE_BUCKET!==process.env.SEC_DOCUMENT_CACHE_BUCKET||env.GIT_SHA!==process.env.GIT_SHA)throw Error("Deploy this release of every SEC processing consumer before switching intake");});'
  done
  bash scripts/deploy-sec-downloads.sh
  filing_topic=sec-filing-download-requests
  schedule='0 * * * *'
fi
if [[ "${SEC_DISCOVERY_QUEUE_ENABLED:-0}" == 1 ]]; then bash scripts/deploy-discovery-enrichment.sh sec; fi
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$pipeline_region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 1 --task-timeout 20m --memory 1Gi --cpu 1 \
  --command node --args dist/collect-sec-filings.cjs,--apply \
  --set-env-vars "^|^ENTITY_SNAPSHOT_BUCKET=$ENTITY_SNAPSHOT_BUCKET|GCP_PROJECT_ID=$GCP_PROJECT_ID|GIT_SHA=${GIT_SHA:-unknown}|SEC_USER_AGENT=$SEC_USER_AGENT|SEC_FILINGS_TOPIC=$filing_topic|SEC_DISCOVERY_REQUEST_TOPIC=|SEC_FILINGS_COLLECTOR_ENABLED=${SEC_FILINGS_COLLECTOR_ENABLED:-0}|EARNINGS_COLLECTION_ENABLED=$earnings_collection|CENTRAL_CACHE_URL=${CENTRAL_CACHE_URL:-}$sec_download_env" --quiet
if [[ "${SEC_DISCOVERY_QUEUE_ENABLED:-0}" == 1 ]]; then
  bash scripts/lib/drain-sec-discovery.sh
  gcloud run jobs update "$job" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --update-env-vars SEC_DISCOVERY_REQUEST_TOPIC=sec-company-discovery-requests --quiet
fi
pipeline_job_invokers "$job"
pipeline_schedule "$job" "$schedule"
