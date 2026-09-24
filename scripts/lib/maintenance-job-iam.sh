#!/usr/bin/env bash
# Shared IAM for Cloud Run maintenance jobs (see DEPLOYMENT.md, "Maintenance
# service accounts"). Every job runs as the shared maintenance runtime account
# and grants roles/run.invoker on itself to:
#   - the shared maintenance scheduler account (Cloud Scheduler starts the job);
#   - the web app's runtime account (/admin/jobs "Run now" starts the job).
# Only adds bindings; never removes any.
#
# Source it from a deploy script, which may use $maintenance_runtime_account and
# $maintenance_scheduler_account for `gcloud run jobs deploy` and the scheduler:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/maintenance-job-iam.sh"
#   check_maintenance_job_iam "$job"   # before changing anything
#   ...deploy or update the job...
#   ensure_maintenance_job_iam "$job"
# or run it directly for an existing job:
#   bash scripts/lib/maintenance-job-iam.sh --check JOB_NAME   # validate only; prints the web account
#   bash scripts/lib/maintenance-job-iam.sh JOB_NAME
#
# Inputs: GCP_PROJECT_ID (required), GCP_REGION (default us-central1),
# WEB_RUNTIME_SERVICE_ACCOUNT (otherwise read from the deployed web service
# CLOUD_RUN_SERVICE_PRODUCTION, default ifindata-web).
# MAINTENANCE_IAM_DRY_RUN=1 prints the mutating gcloud commands instead of running
# them; read-only lookups (describe) still run.

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
maintenance_region="${GCP_REGION:-us-central1}"
# The shared maintenance identities currently keep their original directory-sync names.
maintenance_runtime_account="directory-sync-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
maintenance_scheduler_account="directory-sync-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

maintenance_iam_mutate() {
  if [[ "${MAINTENANCE_IAM_DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY RUN:'; printf ' %q' gcloud "$@"; printf '\n'
  else
    gcloud "$@" >/dev/null
  fi
}

# Prints the web app's runtime service account, or fails if it cannot be determined.
web_runtime_service_account() {
  local account="${WEB_RUNTIME_SERVICE_ACCOUNT:-}" service="${CLOUD_RUN_SERVICE_PRODUCTION:-ifindata-web}"
  if [[ -z "$account" ]]; then
    account="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$maintenance_region" \
      --format='value(spec.template.spec.serviceAccountName)')" || account=""
  fi
  if [[ ! "$account" =~ ^[^@[:space:]]+@[^@[:space:]]+\.gserviceaccount\.com$ ]]; then
    echo "ERROR: could not determine the web app's runtime service account (got '${account}')." >&2
    echo "Set WEB_RUNTIME_SERVICE_ACCOUNT, or check Cloud Run service '$service' in $maintenance_region." >&2
    return 1
  fi
  printf '%s\n' "$account"
}

# Validates the job name and all three accounts without changing anything, and
# exports the resolved WEB_RUNTIME_SERVICE_ACCOUNT so later steps reuse it.
check_maintenance_job_iam() {
  local job="${1:-}" web account
  if [[ ! "$job" =~ ^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$ ]]; then
    echo "ERROR: invalid Cloud Run job name '${job}'." >&2
    return 1
  fi
  for account in "$maintenance_runtime_account" "$maintenance_scheduler_account"; do
    if [[ ! "$account" =~ ^[a-z][-a-z0-9]*@[a-z][-a-z0-9]*\.iam\.gserviceaccount\.com$ ]]; then
      echo "ERROR: invalid shared maintenance service account '${account}'; check GCP_PROJECT_ID." >&2
      return 1
    fi
  done
  web="$(web_runtime_service_account)" || return 1
  export WEB_RUNTIME_SERVICE_ACCOUNT="$web"
}

ensure_maintenance_job_iam() {
  local job="${1:?Usage: ensure_maintenance_job_iam JOB_NAME}" web current member
  check_maintenance_job_iam "$job" || return 1
  web="$WEB_RUNTIME_SERVICE_ACCOUNT"
  current="$(gcloud run jobs describe "$job" --project "$GCP_PROJECT_ID" --region "$maintenance_region" \
    --format='value(spec.template.spec.template.spec.serviceAccountName)')" || return 1
  if [[ "$current" != "$maintenance_runtime_account" ]]; then
    maintenance_iam_mutate run jobs update "$job" --project "$GCP_PROJECT_ID" --region "$maintenance_region" \
      --service-account "$maintenance_runtime_account" --quiet || return 1
  fi
  for member in "$maintenance_scheduler_account" "$web"; do
    maintenance_iam_mutate run jobs add-iam-policy-binding "$job" --project "$GCP_PROJECT_ID" --region "$maintenance_region" \
      --member "serviceAccount:$member" --role roles/run.invoker --quiet || return 1
  done
  echo "Maintenance IAM for $job: runtime $maintenance_runtime_account; run.invoker for $maintenance_scheduler_account and $web."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  if [[ $# -eq 2 && "$1" == "--check" ]]; then
    check_maintenance_job_iam "$2"
    echo "Maintenance IAM inputs for $2 are valid; web app account $WEB_RUNTIME_SERVICE_ACCOUNT." >&2
    printf '%s\n' "$WEB_RUNTIME_SERVICE_ACCOUNT"
  elif [[ $# -eq 1 && "$1" != -* ]]; then
    ensure_maintenance_job_iam "$1"
  else
    echo "Usage: $0 [--check] JOB_NAME" >&2; exit 2
  fi
fi
