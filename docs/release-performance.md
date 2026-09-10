# Release turnaround

Baseline: production run 34482205940 spent 113 seconds verifying and 511 seconds
in deployment (approval waiting time is additional). The deploy step was 393 seconds.

App verification and browser journeys now run in parallel. Both are required before
deployment. The deploy script skips repeated verification only in GitHub Actions
when VERIFIED_COMMIT matches GIT_SHA and the checkout's HEAD. Local deploys retain
verification. The environment-specific container build and production smoke tests
still run. Production approval is unchanged.

GitHub persists the Next.js build cache. Cloud Build uploads explicitly exclude
local dependencies, build outputs, credentials and reports. Cloud Build and rollout
duration and individual build-stage timestamps appear in the deployment job summary.

Index definitions are applied when they change relative to the push's previous
commit; unknown comparison bases conservatively apply them. For a fresh environment
or deliberate data initialization, run Deploy to Cloud Run manually with maintenance
enabled. This initializes the company directory and, in production, verified events.
Normal visual releases do not run these data initialization scripts.

Measure subsequent releases before claiming a five-minute turnaround. Cloud Build
remains the main opportunity; Docker layer caching should be evaluated separately
against its image download/upload overhead.
