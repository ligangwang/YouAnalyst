# Release pipeline

Pull requests run lint, types, unit tests, a Next.js build, standalone packaging
checks, and browser journeys across four runners. Branch releases repeat source
checks and build the environment-specific release in parallel. They reuse PR
browser coverage only when the tested Git tree exactly matches the release.
Coverage records expire after 90 days; unmatched trees need fresh PR checks.

Domain-only email authentication is a required release invariant. The required
`verify-browser` gate requires `test:auth` on every pull request (browser shard 1). These
tests cover signup, login, session restoration, and token refresh through the
website origin, rejecting external browser requests. The server-side Firebase
proxy checks run in the same gate. Both deployment jobs depend on this job;
do not remove or bypass these checks when changing authentication or packaging.
Google's optional sign-in popup is separate from the email authentication flow.

The Linux x64 Node 20 runner creates `.release/app` from Next.js standalone
output, public assets, and static chunks. Before publishing, it starts that
server and checks its commit/environment, a browser JavaScript asset, and an
unauthenticated private API. The manifest is written only after these checks
pass. The deployment script rejects a missing, stale, or wrong-environment
manifest. Cloud Build receives only this runtime directory and packages it
using `Dockerfile.release`; it does not install dependencies or compile again.
The existing full source Dockerfile remains available for manual deployments.

Both the builder and runtime use Linux x64 Node 20 with glibc. Changes to Node,
platform, or native dependencies must keep these compatible. Next.js compiler
caches are separate for staging and production. Browser tests install only the
Chromium headless shell they use.

New commits cancel superseded pull-request checks, but do not cancel a running
branch deployment. Deployment requires successful source checks, exact-tree PR
browser coverage, release packaging checks, and the target environment's rules.
Live smoke tests still run after rollout. Retired company initializers, graph
seed imports and watchlist migration Actions are not part of deployment.

The workflow reports Cloud Build/rollout duration separately from maintenance
and post-deployment checks. Compare the commit timestamp with the deployed
`/api/health` commit to measure time until the website is live, rather than
waiting for all scheduler maintenance to finish.
