# Foreign listing market caps

The SEC worker supports the ten issuer/US-symbol pairs in
`src/lib/fundamentals/foreign-listings.ts`. Each ratio is tied to a SEC CIK and
primary-source evidence. A US price is multiplied by ordinary shares outstanding
and divided by ordinary shares per traded unit. TAL's divisor is 1/3.

Foreign listings may have additional OTC symbols in SEC submissions. Only the
explicitly verified US symbol is eligible; other symbols do not inherit its ratio.
Unknown issuers and forms remain unavailable.

Only reviewed entity-wide outstanding concepts are accepted from companyfacts.
Issued shares, authorized shares, ADSs outstanding, and weighted-average EPS share
counts are not interchangeable. In particular, BABA's 2026 DEI cover fact differs
tenfold from its balance-sheet outstanding fact, so that DEI concept is excluded.

Some quarterly disclosures do not appear in companyfacts. The reviewed share-count
observations provide a dated initial backfill for those cases. Source URLs, dates,
scaling, and class composition are retained in each saved assessment. ASML's count
is reported in millions and TSM's in thousands; their caps remain estimates.
These observations require periodic source review; deployment or a worker rerun
does not update their dates. Newer approved SEC facts replace them. The existing
365-day expiry and split checks apply to all SEC share observations, including the
backfill. The age is measured from the share observation date, not filing or import.

Read-only replay of SEC data retrieved on 2026-09-25 produced usable share bases for
ARM, ASML, BABA, GFS, NBIS, TAL, TSM and VNET. BABA's August monthly return and
VNET's September disclosure replace the older March observations. BIDU now uses
its 2025 annual-report cover: 2,197,993,760 Class A + 524,020,320 Class B shares,
as of 2025-12-31, filed 2026-03-17. This dated estimate is eligible under the
365-day limit. GDS now uses the reviewed March 31 annual-report disclosure after
excluding reserved share awards; see `public-market-cap-coverage.md`.
Do not substitute weighted averages or unverified totals mixing dates/classes.

After deployment, run **Deploy background jobs** (`sec-fundamentals`) to update the worker image
if it has not already been deployed, then run SEC fundamentals maintenance.
Version 4 assessments make the batch upgrade existing reviewed assessments once;
retry cooldowns remain in force. Inspect per-ticker `market_cap_calculated` logs
and `marketCap.reason`, not just the job's overall success status.
