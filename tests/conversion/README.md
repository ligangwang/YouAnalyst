# Browser integration checks

Run `npm ci`, `npx playwright install chromium`, then `npm run test:conversion`.
The deployment workflow runs these checks across four browser shards before deployment.

The suite bundles real client components and, where relevant, route wrappers into
in-memory browser fixtures. Each scenario mocks authentication, navigation and API
responses at its service boundaries. It needs no deployed server, credentials or
production writes. Calendar extraction tests use mocked provider responses and
never make paid API calls.

Desktop Chromium and mobile Chromium cover new/existing Google and email users,
continuation query encoding, watchlist ownership fallback, unchanged default routing,
already-signed-in continuation, failed authentication, and unsafe destinations.
Other journeys cover company search, theme switching, chart interactions, the
calendar, research, feeds and administration.

These are component integration tests. They use real module CSS and, where needed,
compiled Tailwind styles, but do not verify Google's popup service, Firebase
configuration or Next's live routing transport. The production build and deployed
smoke checks remain separate checks.


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

## Adding coverage without duplicating it

Keep pure calculations in the Node test suites. Market-cap scaling and formatting
run once in `tests/graph-layout.test.ts`; browser tests cover how recorded values
actually appear on the map.

Use `fixtures/component-html.ts` for isolated component pages, with service mocks
owned by each scenario. It shares bundling, CSS inclusion, the root element and
script escaping between the calendar and intelligence workspace fixtures.

Theme request caching, cancellation and stale-response handling are covered by
the existing workspace theme-switch journey. The chart lifecycle journey checks
that graph tours and tree growth restart after a committed switch. Reuse those
journeys for new themes rather than adding the same renderer tests per theme.

The existing calendar journey covers release/call grouping, distinct fiscal
periods and dates, mixed statuses, source URLs, filters and failed refreshes.
Add new behavior there when it fits; avoid testing the same grouping rules again
in separate card snapshots.
