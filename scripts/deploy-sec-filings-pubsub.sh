#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/filing-pipeline-deploy.sh"
pipeline_require_enabled
pipeline_delivery_identity
pipeline_topic sec-filings-discovered
pipeline_iam topic sec-filings-discovered roles/pubsub.publisher "serviceAccount:$maintenance_runtime_account"
# The SEC service was deployed with event validation before delivery is enabled.
url="$(gcloud run services describe sec-fundamentals-subscriber --project "$GCP_PROJECT_ID" --region "$pipeline_region" --format='value(status.url)')"
[[ "$url" == https://* ]] || { echo 'Missing SEC subscriber URL' >&2; exit 1; }
pipeline_subscription sec-filings-fundamentals sec-filings-discovered sec-filings-fundamentals-dead-letter "$url"
