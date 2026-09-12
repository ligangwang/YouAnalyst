# Release pipeline

Pull requests run lint, types, unit tests, a Next.js build, standalone packaging
checks, and browser journeys. Branch releases repeat the source and browser
checks, then build once inside the approved deployment job using that
environment's public Firebase and site settings.

Domain-only email authentication is a required release invariant. The required
`verify-browser` job runs `test:auth` for every pull request and release. These
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
branch deployment or migration. Production environment approval and live smoke
tests remain required. The company master initializer remains before rollout;
after its one-time migration, its completion marker makes it a short check.

The workflow reports Cloud Build/rollout duration separately from maintenance
and post-deployment checks. Compare the commit timestamp with the deployed
`/api/health` commit to measure time until the website is live, rather than
waiting for all scheduler maintenance to finish.
