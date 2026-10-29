#!/usr/bin/env bash
set -euo pipefail
service="$1"; revision="$2"; image="$3"; sha="$4"; account="$5"
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
region="${GCP_REGION:-us-central1}"
for attempt in {1..60}; do
  details="$(gcloud run revisions describe "$revision" --project "$GCP_PROJECT_ID" --region "$region" --format=json 2>/dev/null || true)"
  if [[ -n "$details" ]] && node -e '
    let s=""; process.stdin.on("data",x=>s+=x).on("end",()=>{try{const d=JSON.parse(s),c=d.spec?.containers?.[0],e=c?.env??[];
    const ok=d.metadata?.name===process.argv[1]&&c?.image===process.argv[2]&&d.spec?.serviceAccountName===process.argv[4]&&d.spec?.containerConcurrency===5
      &&e.some(x=>x.name==="GIT_SHA"&&x.value===process.argv[3])&&d.status?.conditions?.some(x=>x.type==="Ready"&&x.status==="True");process.exit(ok?0:1);}catch{process.exit(1);}});' "$revision" "$image" "$sha" "$account" <<<"$details"; then
    routing="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$region" --format=json 2>/dev/null || true)"
    if [[ -n "$routing" ]] && node -e '
      let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{const d=JSON.parse(s);const ok=d.status?.conditions?.some(x=>x.type==="Ready"&&x.status==="True")&&d.status?.traffic?.some(x=>x.revisionName===process.argv[1]&&x.percent===100);process.exit(ok?0:1);}catch{process.exit(1);}});' "$revision" <<<"$routing"; then
      echo "Verified ready SEC download revision $revision after import timeout"
      exit 0
    fi
  fi
  sleep 5
done
echo "SEC download revision $revision did not become ready on traffic" >&2
exit 1
