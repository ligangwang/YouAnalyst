#!/usr/bin/env bash
# One-time operator setup, never run by routine CI and never grants project IAM admin.
set -euo pipefail
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
role=instrumentOnboardingEventarcDeploy
deployer="github-deploy-production-sa@$GCP_PROJECT_ID.iam.gserviceaccount.com"
receiver="directory-sync-scheduler@$GCP_PROJECT_ID.iam.gserviceaccount.com"
if gcloud iam roles describe "$role" --project "$GCP_PROJECT_ID" --format=json >/dev/null 2>&1; then
  gcloud iam roles describe "$role" --project "$GCP_PROJECT_ID" --format=json | node -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{
const v=JSON.parse(s);if(JSON.stringify([...v.includedPermissions].sort())!==JSON.stringify(["eventarc.triggers.create","eventarc.triggers.update"]))process.exit(1);
});'
else
  gcloud iam roles create "$role" --project "$GCP_PROJECT_ID" --title 'Instrument onboarding Eventarc deployment' \
    --permissions eventarc.triggers.create,eventarc.triggers.update --stage GA --quiet
fi
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member "serviceAccount:$deployer" \
  --role "projects/$GCP_PROJECT_ID/roles/$role" --condition=None --quiet >/dev/null
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member "serviceAccount:$receiver" \
  --role roles/eventarc.eventReceiver --condition=None --quiet >/dev/null
