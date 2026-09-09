# Analytics traffic exclusions

Google Analytics loads only in the production app environment, over HTTPS on
`youanalyst.com` or `www.youanalyst.com`. Cloud Run service URLs, staging, localhost,
and browsers exposing WebDriver or HeadlessChrome are excluded before Google loads.
The custom event helper is disabled until this gate passes.

For manual development visits (including an agent-controlled browser that does not
expose WebDriver), open **https://youanalyst.com/analytics/opt-out** in each browser
profile/device before visiting the app. This untracked response sets a persistent
opt-out cookie for the public domain and its subdomains. Reload existing app tabs.
The cookie expires after at most 400 days; clearing cookies or starting a new private
session requires opting out again. Delete `youanalyst_analytics_opt_out` in browser
site settings to opt back in. Never assume an ordinary signed-in user is internal.

The exclusions take effect after deployment and do not remove historical data.
When examining older reports, restrict hostname to `youanalyst.com`; manual internal
visits in those historical reports still cannot be reliably separated.

Run `npm run test:analytics` for the collection gate, event suppression, and opt-out
response regression checks. No real Analytics requests are sent by these tests.
