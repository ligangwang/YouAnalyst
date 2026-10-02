#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
pipeline_require_enabled
check_maintenance_job_iam company-graph-subscriber
case "${1:-}" in
  --publisher-only) ;;
  '')
    : "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
    : "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"
    : "${OPENAI_API_KEY:?Reuse the approved existing OpenAI configuration}"
    case "${COMPANY_GRAPH_PROCESSING_ENABLED:-0}" in 0|1) ;; *) echo 'COMPANY_GRAPH_PROCESSING_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
    case "${COMPANY_GRAPH_PAID_ADMISSION_ENABLED:-0}" in 0|1) ;; *) echo 'COMPANY_GRAPH_PAID_ADMISSION_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
    pipeline_delivery_identity ;;
  *) echo 'Usage: deploy-company-graph-pubsub.sh [--publisher-only]' >&2; exit 1 ;;
esac
service=company-graph-subscriber
request=company-graph-requests
subscription=company-graph-worker
pipeline_topic "$request"
pipeline_iam topic "$request" roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
pipeline_iam topic "$request" roles/pubsub.publisher "serviceAccount:$WEB_RUNTIME_SERVICE_ACCOUNT"
# Retain requests before the new website can publish. Do not change an existing
# push subscription during a website-only release.
pipeline_retained_subscription "$subscription" "$request"
if [[ "${1:-}" == --publisher-only ]]; then exit 0; fi
pipeline_topic sec-filings-discovered
# Check an existing service's binding before replacing its revision. First-time
# grants are made below only in the explicitly approved bootstrap mode.
if [[ "${PUBSUB_BOOTSTRAP_IAM:-0}" != 1 && "${FILING_PIPELINE_BOOTSTRAP_IAM:-0}" != 1 ]]; then
  pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
fi
# Reuse the production secret already supplied by the release environment. Never
# inspect the web service's credential, create a secret, or print it in arguments.
umask 077
env_file="$(mktemp)"
trap 'rm -f -- "$env_file"' EXIT
node -e 'const fs=require("fs"),e=process.env; const values={GCP_PROJECT_ID:e.GCP_PROJECT_ID,GIT_SHA:e.GIT_SHA||"unknown",SEC_USER_AGENT:e.SEC_USER_AGENT,OPENAI_API_KEY:e.OPENAI_API_KEY,OPENAI_MODEL:e.OPENAI_MODEL||"gpt-5.4",COMPANY_GRAPH_SUBSCRIPTION:"company-graph-worker",COMPANY_GRAPH_FILINGS_SUBSCRIPTION:"company-graph-filings",COMPANY_GRAPH_PROCESSING_ENABLED:e.COMPANY_GRAPH_PROCESSING_ENABLED||"0",COMPANY_GRAPH_PAID_ADMISSION_ENABLED:e.COMPANY_GRAPH_PAID_ADMISSION_ENABLED||"0"}; fs.writeFileSync(process.argv[1],JSON.stringify(values));' "$env_file"
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --no-allow-unauthenticated \
  --command node --args dist/serve-company-graph.cjs --min-instances 0 --max-instances 1 \
  --concurrency 1 --timeout 600 --memory 1Gi --cpu 1 --cpu-throttling \
  --env-vars-file "$env_file" --quiet
pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format='value(status.url)')"
[[ "$url" == https://* ]] || { echo 'Missing company graph subscriber URL' >&2; exit 1; }
pipeline_subscription "$subscription" "$request" company-graph-dead-letter "$url"
pipeline_subscription company-graph-filings sec-filings-discovered company-graph-filings-dead-letter "$url"
