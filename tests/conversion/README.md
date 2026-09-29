# Auth continuation checks

Run `npm ci`, `npx playwright install chromium`, then `npm run test:conversion`.
The deployment workflow runs these checks in its verification job, before deployment.

The suite bundles the real auth/composer route wrappers and client components into
an in-memory browser fixture. Only Firebase authentication and Next's browser router
are mocked. Watchlist/search GET responses are fixtures; all external requests and
all mutation requests are blocked. It needs no server, credentials or production data.

Desktop Chromium and mobile Chromium cover new/existing Google and email users,
continuation query encoding, watchlist ownership fallback, unchanged default routing,
already-signed-in continuation, failed authentication, and unsafe destinations.

These are component integration tests of navigation and form state. They do not
verify Google's popup service, Firebase configuration, Next's live routing transport,
or the site's full CSS/layout. The production build remains a separate check.


## Chart timing and CI balancing

`node scripts/conversion-shards.mjs 1/4 --reporter=line,json` collects the full
suite and balances costly WebGL tests across four runners. It creates an exact
Playwright test list per runner, including both device projects and new tests.
Use `--list` to inspect an assignment. Weights are estimates, not timeouts or
selection filters; the required browser gate still requires all four runners.

The map fixture's `tour-clock` esbuild plugin accelerates only the tour entry
points in explicitly opted-in tests (8x by default). A rate of zero lets a test
inspect the initial frame before advancing. Production source and user speed
settings are unchanged. CSS fades, camera damping and idle-resume timers keep
real timing. Pure tour tests cover real pacing, frame rates and full cycles
without wall-clock waits; browser tests cover integration and interactions.
The overlapping tree approach check is covered by the full presentation journey.
Its unique disabled-during-exit assertion now uses a small, manually expanded
fixture without waiting through another introduction. Pure graph data/layout
assertions run once in `tests/graph-layout.test.ts`, not in each browser project.
