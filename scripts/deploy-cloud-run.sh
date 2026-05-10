#!/usr/bin/env bash

set -euo pipefail

target="${1:-staging}"

project_id="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT is required}"
region="${GOOGLE_CLOUD_REGION:-us-central1}"
firestore_project_id="${FIRESTORE_PROJECT_ID:-${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-$project_id}}"

case "$target" in
  staging)
    service_name="${CLOUD_RUN_SERVICE_STAGING:-ifindata-web-staging}"
    app_environment="${APP_ENVIRONMENT:-staging}"
    ;;
  production)
    service_name="${CLOUD_RUN_SERVICE_PRODUCTION:-ifindata-web}"
    app_environment="${APP_ENVIRONMENT:-production}"
    ;;
  *)
    echo "Unsupported target: $target"
    echo "Usage: ./scripts/deploy-cloud-run.sh [staging|production]"
    exit 1
    ;;
esac

echo "[1/5] Deploying Firestore indexes"
if [[ "${APPLY_FIRESTORE_INDEXES:-1}" == "1" ]]; then
  FIRESTORE_PROJECT_ID="$firestore_project_id" npm run firestore:indexes:apply
else
  echo "Skipping Firestore index deployment (APPLY_FIRESTORE_INDEXES=${APPLY_FIRESTORE_INDEXES:-0})"
fi

echo "[2/5] Verifying application"
npm run verify

echo "[3/5] Deploying $service_name to Cloud Run via Cloud Build"
image_tag="${region}-docker.pkg.dev/${project_id}/ifindata/ifindata-web:${GIT_SHA:-local}"

build_submit_args=(
  --project "$project_id"
  --config cloudbuild.yaml
  --substitutions "_SERVICE_NAME=$service_name,_REGION=$region,_APP_ENVIRONMENT=$app_environment,_NEXT_PUBLIC_APP_ENVIRONMENT=$app_environment,_GIT_SHA=${GIT_SHA:-local},_IMAGE=${image_tag},_NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL:-},_NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY:-},_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:-},_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-},_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-},_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:-},_NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID:-},_TWELVE_DATA_API_KEY=${TWELVE_DATA_API_KEY:-},_TWELVE_DATA_API_URL=${TWELVE_DATA_API_URL:-},_EODHD_API_TOKEN=${EODHD_API_TOKEN:-},_EODHD_API_URL=${EODHD_API_URL:-},_EODHD_BULK_EOD_BUCKET=${EODHD_BULK_EOD_BUCKET:-},_OPENFIGI_API_KEY=${OPENFIGI_API_KEY:-},_INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN:-},_AI_ANALYST_USER_ID=${AI_ANALYST_USER_ID:-},_OPENAI_API_KEY=${OPENAI_API_KEY:-},_OPENAI_MODEL=${OPENAI_MODEL:-gpt-5.4},_SEC_USER_AGENT=${SEC_USER_AGENT:-},_COMPANY_GRAPH_QUEUE_BATCH_SIZE=${COMPANY_GRAPH_QUEUE_BATCH_SIZE:-1},_ENABLE_PRO_FEATURES=${ENABLE_PRO_FEATURES:-},_ENABLE_BILLING=${ENABLE_BILLING:-},_PRO_BILLING_BYPASS=${PRO_BILLING_BYPASS:-},_GOOGLE_ANALYTICS_ID=${GOOGLE_ANALYTICS_ID:-}"
)

if [[ -n "${CLOUD_BUILD_DEFAULT_BUCKETS_BEHAVIOR:-}" ]]; then
  build_submit_args+=(--default-buckets-behavior "$CLOUD_BUILD_DEFAULT_BUCKETS_BEHAVIOR")
fi

if [[ -n "${CLOUD_BUILD_SOURCE_STAGING_DIR:-}" ]]; then
  build_submit_args+=(--gcs-source-staging-dir "$CLOUD_BUILD_SOURCE_STAGING_DIR")
  echo "INFO: Using custom Cloud Build source staging dir: $CLOUD_BUILD_SOURCE_STAGING_DIR"
elif [[ "${CLOUD_BUILD_USE_CUSTOM_SOURCE_STAGING:-0}" == "1" ]]; then
  echo "WARN: CLOUD_BUILD_USE_CUSTOM_SOURCE_STAGING=1 but CLOUD_BUILD_SOURCE_STAGING_DIR is unset; using default source staging behavior"
fi

if [[ "${DEBUG_GCLOUD_DEPLOY:-0}" == "1" ]]; then
  echo "Deploy debug context:"
  echo "  target=$target"
  echo "  project_id=$project_id"
  echo "  firestore_project_id=$firestore_project_id"
  echo "  region=$region"
  echo "  service_name=$service_name"
  echo "  app_environment=$app_environment"
  echo "  cloud_build_source_staging_dir=${CLOUD_BUILD_SOURCE_STAGING_DIR:-<unset>}"
  echo "  cloud_build_use_custom_source_staging=${CLOUD_BUILD_USE_CUSTOM_SOURCE_STAGING:-0}"
  echo "  cloud_build_default_buckets_behavior=${CLOUD_BUILD_DEFAULT_BUCKETS_BEHAVIOR:-<unset>}"
  printf '  gcloud builds submit args:'
  printf ' %q' "${build_submit_args[@]}"
  printf ' %q\n' .
  echo "Authenticated accounts:"
  gcloud auth list
  echo "Active gcloud config:"
  gcloud config list
fi

submit_stderr_file="$(mktemp)"

if build_id="$(gcloud builds submit "${build_submit_args[@]}" --async --format='value(id)' . 2>"$submit_stderr_file")"; then
  :
else
  cat "$submit_stderr_file" >&2

  if [[ "${CLOUD_BUILD_USE_CUSTOM_SOURCE_STAGING:-0}" != "1" ]] && [[ -n "${CLOUD_BUILD_SOURCE_STAGING_DIR:-}" ]] && grep -E -q "forbidden from accessing the bucket \[${project_id}_cloudbuild\]" "$submit_stderr_file"; then
    echo "Retrying Cloud Build submit with custom source staging dir: $CLOUD_BUILD_SOURCE_STAGING_DIR"
    retry_build_submit_args=("${build_submit_args[@]}" --gcs-source-staging-dir "$CLOUD_BUILD_SOURCE_STAGING_DIR")
    build_id="$(gcloud builds submit "${retry_build_submit_args[@]}" --async --format='value(id)' .)"
  else
    rm -f "$submit_stderr_file"
    exit 1
  fi
fi

rm -f "$submit_stderr_file"

echo "Cloud Build submitted: $build_id"
echo "Logs: https://console.cloud.google.com/cloud-build/builds/$build_id?project=$project_id"

echo "Waiting for build $build_id to complete..."
while true; do
  build_status="$(gcloud builds describe "$build_id" \
    --project "$project_id" \
    --format='value(status)')"
  echo "  status: $build_status"
  case "$build_status" in
    SUCCESS) echo "Build succeeded."; break ;;
    FAILURE|CANCELLED|TIMEOUT|EXPIRED|INTERNAL_ERROR)
      echo "ERROR: build ended with status: $build_status"
      echo "--- Failed step details ---"
      gcloud builds describe "$build_id" \
        --project "$project_id" \
        --format='table[box](steps.name,steps.status,steps.timing.startTime,steps.timing.endTime)' || true
      gcloud builds describe "$build_id" \
        --project "$project_id" \
        --format='value(steps[].status,steps[].args)' || true
      exit 1
      ;;
    *)
      sleep 15
      ;;
  esac
done

echo "[4/5] Resolving deployed service URL"
service_url="$(gcloud run services describe "$service_name" \
  --project "$project_id" \
  --region "$region" \
  --format='value(status.url)')"

if [[ -z "$service_url" ]]; then
  echo "Failed to resolve Cloud Run service URL"
  exit 1
fi

health_url="$service_url/api/health"
echo "[5/5] Smoke testing $health_url"

health_tmp_file="$(mktemp)"
health_status="$(curl --silent --show-error --output "$health_tmp_file" --write-out '%{http_code}' "$health_url" || true)"

if [[ "$health_status" == "200" ]]; then
  cat "$health_tmp_file"
  echo
elif [[ "$health_status" == "401" || "$health_status" == "403" ]]; then
  echo "Health endpoint returned $health_status without authentication; retrying with identity token"
  identity_token="$(gcloud auth print-identity-token --audiences="$service_url" 2>/dev/null || true)"

  if [[ -z "$identity_token" ]]; then
    echo "ERROR: could not obtain identity token for authenticated health check"
    rm -f "$health_tmp_file"
    exit 1
  fi

  auth_health_status="$(curl --silent --show-error --output "$health_tmp_file" --write-out '%{http_code}' \
    -H "Authorization: Bearer $identity_token" \
    "$health_url" || true)"

  if [[ "$auth_health_status" == "200" ]]; then
    cat "$health_tmp_file"
    echo
  else
    echo "ERROR: authenticated health check failed with status $auth_health_status"
    cat "$health_tmp_file" || true
    rm -f "$health_tmp_file"
    exit 1
  fi
else
  echo "ERROR: health check failed with status $health_status"
  cat "$health_tmp_file" || true
  rm -f "$health_tmp_file"
  exit 1
fi

rm -f "$health_tmp_file"

if [[ "${PLAYWRIGHT_RUN_SMOKE:-0}" == "1" ]]; then
  echo "Running Playwright smoke checks against $service_url"
  PLAYWRIGHT_BASE_URL="$service_url" \
  PLAYWRIGHT_EXPECT_STAGING_BANNER="$([[ "$target" == "staging" ]] && echo 1 || echo 0)" \
  npm run smoke:test
fi

echo "Deploy complete: $service_url"
