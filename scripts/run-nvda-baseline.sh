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
# Existing Firestore reads must succeed before execution. No log access or IAM changes.
state_dir="$(mktemp -d)"
trap 'rm -rf "$state_dir"' EXIT
node --import tsx scripts/verify-nvda-baseline.ts before > "$state_dir/before.json"

# One invocation only. An ambiguous failure requires inspection, never an automatic
# second POST. The existing job may retry its task once; baseline mode is idempotent.
execution="$(gcloud run jobs execute "$job" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
  --args=dist/collect-sec-filings.cjs,--apply,--baseline-only,--company=NVDA \
  --update-env-vars=SEC_FILINGS_COLLECTOR_ENABLED=1 --wait --quiet --format='value(metadata.name)')"
[[ "$execution" =~ ^collect-sec-filings-production-[a-z0-9]+$ ]] || { echo 'Execution identity unavailable; inspect before retrying.' >&2; exit 1; }
echo "Execution: $execution"
check_disabled

# Inspect the one execution, never submit another job if verification fails.
gcloud run jobs executions describe "$execution" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json --verbosity=error |
  EXPECTED_EXECUTION="$execution" node scripts/check-nvda-baseline.mjs execution > "$state_dir/execution.json"
node --import tsx scripts/verify-nvda-baseline.ts after "$state_dir/before.json" "$state_dir/execution.json"
