#!/usr/bin/env bash
# The new compatibility publisher is already deployed with direct mode. Let old
# executions finish naturally before enabling company tasks. Never stop a job,
# schedule or subscription to accelerate this transition.
set -euo pipefail
: "${GCP_PROJECT_ID:?Set project}" "${GIT_SHA:?Set release SHA}"
deadline=$((SECONDS+1500))
while (( SECONDS < deadline )); do
  active="$(gcloud run jobs executions list --job collect-sec-filings-production --project "$GCP_PROJECT_ID" --region "${GCP_REGION:-us-central1}" --limit 100 --format=json | node -e '
let input="";process.stdin.on("data",d=>input+=d).on("end",()=>{const rows=JSON.parse(input);if(!Array.isArray(rows))throw Error("Missing execution state");const active=rows.filter(row=>!row.status?.completionTime);if(rows.length===100&&!rows.some(row=>row.status?.completionTime))throw Error("Execution inspection bound exhausted");console.log(active.filter(row=>!(row.spec?.template?.spec?.containers?.[0]?.env??[]).some(e=>e.name==="GIT_SHA"&&e.value===process.env.GIT_SHA)).length);});')"
  [[ "$active" =~ ^[0-9]+$ ]] || exit 1
  [[ "$active" == 0 ]] && exit 0
  echo "Waiting for $active older SEC execution(s) to finish naturally."
  sleep 15
done
echo 'Older SEC executions still running; direct compatibility mode remains active.' >&2
exit 1
