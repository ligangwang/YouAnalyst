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
180-day expiry and split checks apply to all observations, including the backfill.

Read-only replay of SEC data retrieved on 2026-09-25 produced usable share bases for
ARM, ASML, BABA, GFS, NBIS, TAL, TSM and VNET. BABA and VNET use March 31 observations
and will expire at the 180-day limit unless newer counts are reviewed. BIDU and GDS
remain unavailable: their current entity-wide eligible counts have not been verified.
Do not clear those statuses using weighted averages or totals mixing dates/classes.

After deployment, run **Deploy SEC fundamentals job** to update the worker image
if it has not already been deployed, then run SEC fundamentals maintenance.
Version 2 assessments make the batch upgrade existing foreign assessments once;
retry cooldowns remain in force. Inspect per-ticker `market_cap_calculated` logs
and `marketCap.reason`, not just the job's overall success status.
