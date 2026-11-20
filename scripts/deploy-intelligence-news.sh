#!/usr/bin/env bash
set -euo pipefail
case "${NEWS_ENRICHMENT_QUEUE_ENABLED:-0}" in 0|1) ;; *) echo 'Invalid article queue flag' >&2; exit 1 ;; esac
source "$(dirname "${BASH_SOURCE[0]}")/lib/cn-discovery-config.sh"
if [[ "$CN_DISCOVERY_QUEUE_ENABLED" == 1 ]]; then bash scripts/deploy-cn-discovery.sh --check; fi
export ENTITY_SNAPSHOT_BUCKET="${ENTITY_SNAPSHOT_BUCKET:-${EODHD_BULK_EOD_BUCKET:-}}"
: "${ENTITY_SNAPSHOT_BUCKET:?Set ENTITY_SNAPSHOT_BUCKET or EODHD_BULK_EOD_BUCKET for SQLite company reads}"
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${FUNDAMENTALS_IMAGE:?Set FUNDAMENTALS_IMAGE}"
region="${GCP_REGION:-us-central1}"
job=collect-intelligence-news-production
cn_job=collect-cn-announcements-production
case "${NEWS_SOURCE_QUEUE_ENABLED:-0}" in 0|1) ;; *) echo 'NEWS_SOURCE_QUEUE_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
export NEWS_SOURCE_QUEUE_ENABLED="${NEWS_SOURCE_QUEUE_ENABLED:-0}"
case "${INTELLIGENCE_NEWS_COLLECTOR_ENABLED:-0}" in 0|1) ;; *) echo 'INTELLIGENCE_NEWS_COLLECTOR_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
case "${CALENDAR_EXTRACTION_ENABLED:-0}" in 0|1) ;; *) echo 'CALENDAR_EXTRACTION_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
if [[ "${INTELLIGENCE_NEWS_COLLECTOR_ENABLED:-0}" == 1 || "${CALENDAR_EXTRACTION_ENABLED:-0}" == 1 ]]; then
  : "${OPENAI_API_KEY:?Reuse the approved existing OpenAI configuration}"
fi
if [[ "${CALENDAR_EXTRACTION_ENABLED:-0}" == 1 ]]; then
  : "${OPENAI_API_KEY:?Reuse the approved existing OpenAI configuration}"
  [[ "${OPENAI_CALENDAR_MODEL:-}" == gpt-6-luna ]] || { echo 'OPENAI_CALENDAR_MODEL must be gpt-6-luna' >&2; exit 1; }
fi
source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
check_maintenance_job_iam "$job"
check_maintenance_job_iam "$cn_job"
# Deploy and wire the private subscriber before the scheduled job can publish.
if [[ "$CN_DISCOVERY_QUEUE_ENABLED" == 1 ]]; then bash scripts/deploy-cn-discovery.sh; fi
if [[ "${NEWS_ENRICHMENT_QUEUE_ENABLED:-0}" == 1 ]]; then bash scripts/deploy-discovery-enrichment.sh article; fi
env_file="$(mktemp)"
cn_env_file="$(mktemp)"
chmod 600 "$env_file" "$cn_env_file"
trap 'rm -f "$env_file" "$cn_env_file"' EXIT
node - "$env_file" <<'NODE'
const fs = require('node:fs');
const env = {NODE_OPTIONS:"--max-old-space-size=1536",ENTITY_SNAPSHOT_BUCKET:process.env.ENTITY_SNAPSHOT_BUCKET,CENTRAL_CACHE_URL:process.env.CENTRAL_CACHE_URL || '',GCP_PROJECT_ID:process.env.GCP_PROJECT_ID,GIT_SHA:process.env.GIT_SHA || 'unknown',
  SEC_USER_AGENT:process.env.SEC_USER_AGENT || '',
  INTELLIGENCE_NEWS_COLLECTOR_ENABLED:process.env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED || '0',
  CN_DISCOVERY_REQUEST_TOPIC:process.env.CN_DISCOVERY_QUEUE_ENABLED === '1' ? 'cn-company-discovery-requests' : '',
  NEWS_SOURCE_REQUEST_TOPIC:'',
  NEWS_ENRICHMENT_REQUEST_TOPIC:process.env.NEWS_ENRICHMENT_QUEUE_ENABLED === '1' ? 'news-article-enrichment-requests' : '',
  EARNINGS_COLLECTION_ENABLED:process.env.EARNINGS_COLLECTION_ENABLED || '0',
  NEWS_ANALYSIS_MONTHLY_BUDGET_USD:process.env.NEWS_ANALYSIS_MONTHLY_BUDGET_USD || '5',
  CALENDAR_EXTRACTION_ENABLED:process.env.CALENDAR_EXTRACTION_ENABLED || '0',
  OPENAI_CALENDAR_MODEL:process.env.OPENAI_CALENDAR_MODEL || 'gpt-6-luna'};
if (env.INTELLIGENCE_NEWS_COLLECTOR_ENABLED === '1' || env.CALENDAR_EXTRACTION_ENABLED === '1') env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
fs.writeFileSync(process.argv[2],JSON.stringify(env),{mode:0o600});
NODE
node - "$env_file" "$cn_env_file" <<'CN_ENV'
const fs = require('node:fs');
const env = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const key of ['OPENAI_API_KEY','OPENAI_CALENDAR_MODEL','CALENDAR_EXTRACTION_ENABLED','NEWS_ANALYSIS_MONTHLY_BUDGET_USD','NEWS_ENRICHMENT_REQUEST_TOPIC','SEC_USER_AGENT']) delete env[key];
fs.writeFileSync(process.argv[3], JSON.stringify(env), {mode:0o600});
CN_ENV
gcloud run jobs deploy "$cn_job" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 0 --task-timeout 20m --memory 2Gi --cpu 1 \
  --command node --args dist/collect-intelligence-news.cjs,--apply,--cn-announcements-only \
  --env-vars-file "$cn_env_file" --quiet
ensure_maintenance_job_iam "$cn_job"
cn_args=(--project "$GCP_PROJECT_ID" --location "$region" --schedule '0 12 * * *' --time-zone America/New_York
  --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$cn_job:run"
  --http-method POST --oauth-service-account-email "$maintenance_scheduler_account" --message-body '{}'
  --attempt-deadline 180s --max-retry-attempts 0 --quiet)
if gcloud scheduler jobs describe "$cn_job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$cn_job" "${cn_args[@]}"
else
  gcloud scheduler jobs create http "$cn_job" "${cn_args[@]}"
  # Mirror the existing news schedule on first deployment.
  if [[ "$(gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" --format='value(state)')" != ENABLED ]]; then
    gcloud scheduler jobs pause "$cn_job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
  fi
fi
gcloud run jobs deploy "$job" --project "$GCP_PROJECT_ID" --region "$region" \
  --image "$FUNDAMENTALS_IMAGE" --service-account "$maintenance_runtime_account" --tasks 1 --parallelism 1 \
  --max-retries 0 --task-timeout 20m --memory 2Gi --cpu 1 \
  --command node --args dist/collect-intelligence-news.cjs,--apply,--skip-cn-announcements \
  --env-vars-file "$env_file" --quiet
ensure_maintenance_job_iam "$job"
# Preserve the hourly cadence of the remaining news work.
args=(--project "$GCP_PROJECT_ID" --location "$region" --schedule '7 * * * 1-5' --time-zone America/New_York
  --uri "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/$region/jobs/$job:run"
  --http-method POST --oauth-service-account-email "$maintenance_scheduler_account" --message-body '{}'
  --attempt-deadline 180s --max-retry-attempts 0 --quiet)
if gcloud scheduler jobs describe "$job" --project "$GCP_PROJECT_ID" --location "$region" >/dev/null 2>&1; then
  # Preserve an existing operator pause during routine releases.
  gcloud scheduler jobs update http "$job" "${args[@]}"
else
  gcloud scheduler jobs create http "$job" "${args[@]}"
  gcloud scheduler jobs pause "$job" --project "$GCP_PROJECT_ID" --location "$region" --quiet
fi
