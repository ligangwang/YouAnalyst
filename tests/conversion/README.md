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
