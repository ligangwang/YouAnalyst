#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GIT_SHA:?Set GIT_SHA}"
export GCP_REGION="${GCP_REGION:-us-central1}"
case "${1:-}" in
  all) targets=(sec-fundamentals cn-fundamentals private-valuations ticker-sync eod-maintenance directory) ;;
  fundamentals) targets=(sec-fundamentals cn-fundamentals private-valuations ticker-sync eod-maintenance) ;;
  sec-filings) targets=(sec-fundamentals company-graph sec-filings) ;;
  sec-fundamentals|cn-fundamentals|private-valuations|ticker-sync|eod-maintenance|directory|company-graph|earnings) targets=("$1") ;;
  *) echo 'Select all, sec-fundamentals, cn-fundamentals, private-valuations, ticker-sync, eod-maintenance, company-graph, sec-filings, earnings or directory' >&2; exit 1 ;;
esac
# The filing/graph pipeline is an explicit production rollout. Disabled releases
# keep every existing worker path and schedule unchanged.
case "${ENABLE_SEC_FILING_PIPELINE:-0}" in 0|1) ;; *) echo 'ENABLE_SEC_FILING_PIPELINE must be 0 or 1' >&2; exit 1 ;; esac
if [[ "${ENABLE_SEC_FILING_PIPELINE:-0}" == 1 && ( "$1" == all || "$1" == fundamentals ) ]]; then
  targets+=(company-graph sec-filings)
fi
# Earnings is a separate, default-off rollout. No existing SEC/graph switch is
# inferred from it, and routine releases cannot bootstrap its resource access.
for flag in EARNINGS_PIPELINE_ENABLED EARNINGS_COLLECTION_ENABLED EARNINGS_PROCESSING_ENABLED EARNINGS_BOOTSTRAP_IAM; do
  case "${!flag:-0}" in 0|1) ;; *) echo "$flag must be 0 or 1" >&2; exit 1 ;; esac
done
if [[ "${EARNINGS_PIPELINE_ENABLED:-0}" == 1 && ( "$1" == all || "$1" == fundamentals ) ]]; then
  targets+=(earnings)
fi
if [[ "${EARNINGS_BOOTSTRAP_IAM:-0}" != 0 && "$1" != earnings ]]; then
  echo 'Earnings resource setup must use the isolated earnings target.' >&2; exit 1
fi
# Validate every selected target before any build or mutation.
for target in "${targets[@]}"; do
  if [[ "$target" == earnings ]]; then
    bash scripts/deploy-earnings.sh --check
    continue
  fi
  job="refresh-$target-production"
  if [[ "$target" == directory ]]; then job=sync-cni-directory-production; fi
  if [[ "$target" == sec-filings ]]; then job=collect-sec-filings-production; fi
  if [[ "$target" == sec-fundamentals ]]; then : "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"; fi
  if [[ "$target" == company-graph || "$target" == sec-filings ]]; then
    [[ "${ENABLE_SEC_FILING_PIPELINE:-0}" == 1 ]] || { echo 'Set ENABLE_SEC_FILING_PIPELINE=1 only after rollout review' >&2; exit 1; }
    : "${SEC_USER_AGENT:?Set SEC_USER_AGENT}"
    : "${OPENAI_API_KEY:?Reuse the approved existing OpenAI configuration}"
    case "${COMPANY_GRAPH_QUEUE_BATCH_SIZE:-1}" in [1-5]) ;; *) echo 'COMPANY_GRAPH_QUEUE_BATCH_SIZE must be 1 through 5' >&2; exit 1 ;; esac
    case "${COMPANY_GRAPH_PROCESSING_ENABLED:-0}" in 0|1) ;; *) echo 'COMPANY_GRAPH_PROCESSING_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
    case "${COMPANY_GRAPH_PAID_ADMISSION_ENABLED:-0}" in 0|1) ;; *) echo 'COMPANY_GRAPH_PAID_ADMISSION_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
    case "${SEC_FILINGS_COLLECTOR_ENABLED:-0}" in 0|1) ;; *) echo 'SEC_FILINGS_COLLECTOR_ENABLED must be 0 or 1' >&2; exit 1 ;; esac
  fi
  WEB_RUNTIME_SERVICE_ACCOUNT="$(bash scripts/lib/maintenance-job-iam.sh --check "$job")"
  export WEB_RUNTIME_SERVICE_ACCOUNT
done
if [[ "$1" != directory ]]; then
  image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/ifindata/sec-fundamentals:$GIT_SHA"
  bash scripts/build-fundamentals.sh "$image"
  FUNDAMENTALS_IMAGE="$(gcloud artifacts docker images describe "$image" --project "$GCP_PROJECT_ID" --format='value(image_summary.fully_qualified_digest)')"
  [[ "$FUNDAMENTALS_IMAGE" == *@sha256:* ]] || { echo 'Missing fundamentals image digest' >&2; exit 1; }
  export FUNDAMENTALS_IMAGE
fi
for target in "${targets[@]}"; do
  if [[ "$target" == directory ]]; then
    image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/ifindata/directory-sync:$GIT_SHA"
    bash scripts/build-fundamentals.sh "$image" cloudbuild.directory-sync.yaml
    image="$(gcloud artifacts docker images describe "$image" --project "$GCP_PROJECT_ID" --format='value(image_summary.fully_qualified_digest)')"
    [[ "$image" == *@sha256:* ]] || { echo 'Missing directory image digest' >&2; exit 1; }
    export DIRECTORY_SYNC_IMAGE="$image"
    bash scripts/deploy-directory-pubsub.sh
    gcloud run jobs update sync-cni-directory-production --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --image "$image" --update-env-vars DIRECTORY_REQUEST_TOPIC=cni-directory-requests --quiet
    bash scripts/lib/maintenance-job-iam.sh sync-cni-directory-production
  else
    bash "scripts/deploy-$target.sh"
  fi
done
