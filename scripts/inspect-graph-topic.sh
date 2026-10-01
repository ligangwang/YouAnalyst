#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GCP_REGION:?Set GCP_REGION}"
: "${CLOUD_RUN_SERVICE_PRODUCTION:?Set CLOUD_RUN_SERVICE_PRODUCTION}"
# Never echo the service document or unrelated environment values, including on
# parse/mismatch errors. This is one existing-resource read, not a configuration.
gcloud run services describe "$CLOUD_RUN_SERVICE_PRODUCTION" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json --verbosity=error |
  node -e '
    let input = "";
    process.stdin.setEncoding("utf8").on("data", chunk => { input += chunk; }).on("end", () => {
      try {
        const env = JSON.parse(input).spec.template.spec.containers[0].env;
        const selected = env.filter(item => item.name === "COMPANY_GRAPH_REQUEST_TOPIC");
        if (selected.length !== 1 || selected[0].value !== "company-graph-requests") throw new Error();
        console.log("COMPANY_GRAPH_REQUEST_TOPIC=company-graph-requests");
      } catch {
        console.error("Could not verify the expected web graph topic; service configuration was not printed.");
        process.exitCode = 1;
      }
    });'
