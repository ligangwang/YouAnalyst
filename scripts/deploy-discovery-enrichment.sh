#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
case "${1:-}" in sec|article) kind="$1" ;; *) echo 'Usage: deploy-discovery-enrichment.sh sec|article [--check]' >&2; exit 1 ;; esac
case "${2:-}" in ''|--check) ;; *) exit 1 ;; esac
case "${DISCOVERY_ENRICHMENT_BOOTSTRAP_IAM:-0}" in 0|1) ;; *) exit 1 ;; esac
for flag in SEC_DISCOVERY_QUEUE_ENABLED NEWS_ENRICHMENT_QUEUE_ENABLED SEC_INCREMENTAL_DOWNLOADS_ENABLED EARNINGS_COLLECTION_ENABLED CALENDAR_EXTRACTION_ENABLED; do
  case "${!flag:-0}" in 0|1) ;; *) echo "Invalid $flag" >&2; exit 1 ;; esac
done
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
export FILING_PIPELINE_BOOTSTRAP_IAM="${DISCOVERY_ENRICHMENT_BOOTSTRAP_IAM:-0}"
if [[ "$kind" == sec ]]; then
  source "$(dirname "${BASH_SOURCE[0]}")/lib/sec-download-config.sh"
  service=sec-company-discovery-subscriber; topic=sec-company-discovery-requests; subscription=sec-company-discovery-worker; dead=sec-company-discovery-dead-letter; bundle=serve-sec-discovery
else
  service=news-article-enrichment-subscriber; topic=news-article-enrichment-requests; subscription=news-article-enrichment-worker; dead=news-article-enrichment-dead-letter; bundle=serve-news-enrichment
fi
number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
[[ "$number" =~ ^[0-9]+$ ]] || exit 1
pipeline_agent="service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"
if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 0 ]]; then
  for name in "$topic" "$dead"; do gcloud pubsub topics describe "$name" --project "$GCP_PROJECT_ID" >/dev/null; done
  pipeline_subscription_topic "$subscription" "$topic"
  pipeline_subscription_topic "$dead-audit" "$dead"
  gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" >/dev/null
  pipeline_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
  pipeline_iam topic "$dead" roles/pubsub.publisher "serviceAccount:$pipeline_agent"
  pipeline_iam subscription "$subscription" roles/pubsub.subscriber "serviceAccount:$pipeline_agent"
  pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
else
  # Even explicit setup cannot reuse an existing subscription for another topic.
  for pair in "$subscription:$topic" "$dead-audit:$dead"; do
    name="${pair%%:*}"
    if gcloud pubsub subscriptions describe "$name" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then pipeline_subscription_topic "$name" "${pair#*:}"; fi
  done
fi
[[ "${2:-}" == --check ]] && exit 0
: "${FUNDAMENTALS_IMAGE:?Set the reviewed shared worker image}"
: "${ENTITY_SNAPSHOT_BUCKET:?Set ENTITY_SNAPSHOT_BUCKET}"
if [[ "$kind" == sec ]]; then : "${SEC_USER_AGENT:?Reuse the existing SEC contact}"; else : "${OPENAI_API_KEY:?Reuse the approved existing AI key}"; fi
if [[ "$FILING_PIPELINE_BOOTSTRAP_IAM" == 1 ]]; then
  pipeline_topic "$topic"; pipeline_topic "$dead"
  pipeline_retained_subscription "$subscription" "$topic"
  pipeline_retained_subscription "$dead-audit" "$dead"
  pipeline_iam topic "$topic" roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
fi
env_file="$(mktemp)"; chmod 600 "$env_file"; trap 'rm -f "$env_file"' EXIT
node - "$env_file" "$kind" <<'NODE'
const fs=require('node:fs'),p=process.env,kind=process.argv[3];
const env={GCP_PROJECT_ID:p.GCP_PROJECT_ID,GIT_SHA:p.GIT_SHA||'unknown',ENTITY_SNAPSHOT_BUCKET:p.ENTITY_SNAPSHOT_BUCKET,CENTRAL_CACHE_URL:p.CENTRAL_CACHE_URL||''};
if(kind==='sec')Object.assign(env,{SEC_DISCOVERY_SUBSCRIPTION:'sec-company-discovery-worker',SEC_DISCOVERY_QUEUE_ENABLED:p.SEC_DISCOVERY_QUEUE_ENABLED||'0',SEC_USER_AGENT:p.SEC_USER_AGENT,EARNINGS_COLLECTION_ENABLED:p.EARNINGS_COLLECTION_ENABLED||'0',SEC_INCREMENTAL_DOWNLOADS_ENABLED:p.SEC_INCREMENTAL_DOWNLOADS_ENABLED||'0',SEC_DOCUMENT_CACHE_BUCKET:p.SEC_DOCUMENT_CACHE_BUCKET||''});
else Object.assign(env,{NEWS_ENRICHMENT_SUBSCRIPTION:'news-article-enrichment-worker',NEWS_ENRICHMENT_QUEUE_ENABLED:p.NEWS_ENRICHMENT_QUEUE_ENABLED||'0',CALENDAR_EXTRACTION_ENABLED:p.CALENDAR_EXTRACTION_ENABLED||'0',OPENAI_API_KEY:p.OPENAI_API_KEY,OPENAI_CALENDAR_MODEL:p.OPENAI_CALENDAR_MODEL||'gpt-6-luna',NEWS_ANALYSIS_MONTHLY_BUDGET_USD:p.NEWS_ANALYSIS_MONTHLY_BUDGET_USD||'5'});
fs.writeFileSync(process.argv[2],JSON.stringify(env),{mode:0o600});
NODE
# Both services are private. Per-instance serialization also protects the SEC
# issuer registry; the existing global gates and paid intents remain decisive.
gcloud run deploy "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --no-allow-unauthenticated \
  --command node --args "dist/$bundle.cjs" --min-instances 0 --max-instances 2 --concurrency 1 \
  --timeout 600 --memory 1Gi --cpu 1 --cpu-throttling --env-vars-file "$env_file" --quiet
pipeline_iam service "$service" roles/run.invoker "serviceAccount:$maintenance_scheduler_account"
url="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format='value(status.url)')"
[[ "$url" == https://* ]] || exit 1
pipeline_subscription "$subscription" "$topic" "$dead" "$url"
