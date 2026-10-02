#!/usr/bin/env bash
set -euo pipefail
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
pipeline_require_enabled
job=refresh-company-graph-production
check_maintenance_job_iam "$job"
case "${COMPANY_GRAPH_QUEUE_BATCH_SIZE:-1}" in [1-5]) ;; *) echo 'COMPANY_GRAPH_QUEUE_BATCH_SIZE must be 1 through 5' >&2; exit 1 ;; esac
bash scripts/deploy-company-graph-pubsub.sh
# The publisher reads the durable queue only; SEC and OpenAI credentials stay on
# the extraction subscriber. Its initial schedule must be deliberately resumed.
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$pipeline_region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 1 --task-timeout 20m --memory 512Mi --cpu 1 \
  --command node --args dist/refresh-company-graph.cjs,--apply \
  --set-env-vars "^|^GCP_PROJECT_ID=$GCP_PROJECT_ID|GIT_SHA=${GIT_SHA:-unknown}|COMPANY_GRAPH_REQUEST_TOPIC=company-graph-requests|COMPANY_GRAPH_QUEUE_BATCH_SIZE=${COMPANY_GRAPH_QUEUE_BATCH_SIZE:-1}|COMPANY_GRAPH_PAID_ADMISSION_ENABLED=${COMPANY_GRAPH_PAID_ADMISSION_ENABLED:-0}" --quiet
pipeline_job_invokers "$job"
pipeline_schedule "$job" '*/5 * * * *'
