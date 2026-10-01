#!/usr/bin/env bash
set -euo pipefail
[[ "${GCP_PROJECT_ID:-}" == ifindata-80905 && "${GCP_REGION:-}" == us-central1 ]] || exit 1
[[ "${APPROVED_WORKER_COMMIT:-}" =~ ^[a-f0-9]{40}$ ]] || exit 1
job=collect-sec-filings-production
export EXPECTED_IMAGE
EXPECTED_IMAGE="$(gcloud artifacts docker images describe \
  "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/ifindata/sec-fundamentals:$APPROVED_WORKER_COMMIT" \
  --project "$GCP_PROJECT_ID" --format='value(image_summary.fully_qualified_digest)' --verbosity=error)"

check_disabled() {
  gcloud run jobs describe "$job" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json --verbosity=error |
    node scripts/check-nvda-baseline.mjs collector
  gcloud run services describe company-graph-subscriber --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json --verbosity=error |
    node scripts/check-nvda-baseline.mjs graph
  for schedule in refresh-company-graph-production collect-sec-filings-production; do
    [[ "$(gcloud scheduler jobs describe "$schedule" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" --format='value(state)' --verbosity=error)" == PAUSED ]] || {
      echo 'Expected both new schedules to remain paused.' >&2; return 1;
    }
  done
}
check_disabled
# Prove existing log-read access before executing anything. Never grant missing IAM.
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="collect-sec-filings-production"' \
  --project "$GCP_PROJECT_ID" --limit=1 --format='value(timestamp)' --verbosity=error >/dev/null

# One invocation only. An ambiguous failure requires inspection, never an automatic
# second POST. The existing job may retry its task once; baseline mode is idempotent.
execution="$(gcloud run jobs execute "$job" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
  --args=dist/collect-sec-filings.cjs,--apply,--baseline-only,--company=NVDA \
  --update-env-vars=SEC_FILINGS_COLLECTOR_ENABLED=1 --wait --quiet --format='value(metadata.name)')"
[[ "$execution" =~ ^collect-sec-filings-production-[a-z0-9]+$ ]] || { echo 'Execution identity unavailable; inspect before retrying.' >&2; exit 1; }
echo "Execution: $execution"
check_disabled

log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT
filter="resource.type=\"cloud_run_job\" AND labels.\"run.googleapis.com/execution_name\"=\"$execution\" AND jsonPayload.message=\"collect-sec-filings: run_completed\""
for attempt in {1..12}; do
  gcloud logging read "$filter" --project "$GCP_PROJECT_ID" --limit=10 --freshness=1h --order=desc --format=json --verbosity=error > "$log_file"
  if node scripts/check-nvda-baseline.mjs summary < "$log_file"; then exit 0; else result=$?; fi
  [[ "$result" == 2 ]] || exit "$result"
  sleep 10
done
echo 'Execution completed but its bounded summary is not visible yet; inspect this execution, do not rerun it.' >&2
exit 1
