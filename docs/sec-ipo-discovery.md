# SEC IPO discovery

The existing `collect-sec-filings-production` job also scans global SEC daily
indexes when `SEC_IPO_DISCOVERY_ENABLED=1`. It does not depend on the list of
companies already in YouAnalyst. Existing SEC filing schedules and subscriptions
are preserved. The deploy script preserves the live flag; its first deployment
defaults to disabled.

## Confirmation and identity

S-1/F-1 registrations and amendments create pending candidates. A final 424B4 or
424B1 prospectus must explicitly describe a current initial public offering on
its cover and an approved/listed symbol on a supported US exchange. The current
SEC ticker/exchange map and same-CIK submissions metadata must agree. Historical
IPO mentions, resales, applications for listing, withdrawals, ambiguous mappings,
SPAC units, and missing evidence do not trigger automatic admission. The cover
parser is deliberately conservative; unmatched cases remain pending.

CIK identifies the issuer. Normalized CIK variants are checked transactionally
against existing companies. Listing claims use CIK, MIC and symbol; instruments
retain the existing `US:symbol` identity scheme. Additional listings can share
one issuer. Conflicting, private, deleted, reused-ticker or multiple-canonical
identities go to review rather than overwriting existing records. Existing
editorial data is preserved. Filing dates are never used as first-trading dates.

Company creation, listing/issuer claims and onboarding intent are atomic.
Automated requests use `requestSource: SEC_IPO` and `requestedByUid: null` in the
existing onboarding collection. There is no synthetic user or requester entry.
Real users can subsequently join the same request. All ordinary onboarding
verification and failure rules still apply, including limited IPO price history.

## Bounds and status

The approved `sec_ipo_discovery` collection contains `scan`, `candidate_CIK`,
`issuer_CIK`, and hashed `listing_*` documents. It holds evidence, pending/review
status, identity claims, retry times, counters and a global fenced scan lease.
Only approved fields are used. A single-field `nextCheckAt` index supports pending
work; no composite index or bulk data migration is required.

Each run has a two-minute budget, at most five index fetches, 30 candidate changes,
10 candidate checks and five new listings. Writes are serialized with one-second
pauses and checked against the existing onboarding capacity monitor. Admission
stops when capacity pauses, the heartbeat becomes stale, the lease expires or the
deadline is reached. Provider/storage errors stop new IPO work; existing known-
company SEC collection continues independently. SEC requests use the existing
shared request budget and declared User-Agent. The first run starts a rolling
30-day backfill, advancing at most two older calendar days per invocation, and
rechecks the latest three days for late indexes. Pending issuers are revisited
daily. The job's existing schedule determines discovery latency.

Inspect `sec_ipo_discovery/scan` for `lastRunAt`, `lastError`, `counts` and `cursor`;
inspect candidates for `filings`, `status`, `nextCheckAt` and `lastError`. Job logs
include `sec_ipo_discovery_completed` or `sec_ipo_discovery_deferred`. REVIEW needs
an identity/evidence decision, not an automatic retry. The onboarding admin page
shows automated provenance and any downstream blocked checkpoint.

## Availability-preserving rollout

1. Deploy the reader compatibility release to the website and onboarding workers
   before any automated/null-requester records exist. Verify its candidate,
   production smoke tests and unchanged onboarding maximum capacity of 2.
2. Deploy discovery with its flag disabled. Keep the compatibility revision as
   the website rollback target. Verify the new candidate and worker delivery
   checks, and wait for pre-compatibility onboarding executions to finish.
3. Enable only the existing collector job's `SEC_IPO_DISCOVERY_ENABLED` variable,
   execute one bounded run, and inspect counts, candidate state, website errors
   and event backlog. This does not stop the website or any schedule.
4. Keep the maximum onboarding worker capacity at 2. Future deployments preserve
   the live flag and worker scaling. To stop new IPO discovery, set only this flag
   to 0; existing filing collection and onboarding requests continue.

Sources: [SEC EDGAR access and indexes](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data),
[SEC submissions API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
