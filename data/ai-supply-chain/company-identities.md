# AI map company identity enrichment

Reviewed 2026-09-13. This batch fills geography and listing metadata for the 129 listed companies already on the map. The three private companies already have reviewed identity fields and are untouched.

`country` describes the country/region of the disclosed business office or corporate headquarters/campus. It is not inferred from the exchange, and is not a claim about incorporation, tax domicile, ownership, or all operating locations. Each row records the exact basis and original source. SEC business addresses supply most US-listed issuers; CNINFO reports supply Chinese office locations. NXP's issuer FAQ, Credo's contact page and Alibaba's corporate FAQ resolve missing or registered-address-only SEC data.

Listings are the verified US or A-share securities represented by existing IDs. SEC's company ticker/exchange directory and CNINFO's issuer directory/disclosures supply the evidence. This is not an exhaustive inventory of secondary listings worldwide. Existing listing records are preserved and new verified records appended without creating duplicate company nodes.

The US catalog previously wrote its provider trading-country value (`United States`) into company `country`. The batch explicitly permits that exact legacy value through `expectedCountry`, records it in review evidence, and rejects any other conflicting country. Future ticker sync writes this provider value as `listingCountry` so it cannot overwrite reviewed company geography.

## Retired publication procedure

This fixed-batch publication operation is retired. The former GitHub Actions launcher is no longer available. The data, scripts and validation tests are retained as historical maintenance material, not an active publication runbook. Use the current admin research tools for routine work. Reusing this batch requires a newly reviewed operational procedure covering authentication, current evidence, preview approval, before-images, write consistency and post-write verification; do not treat the old batch review as authorization to republish. See [Actions and admin jobs](../../docs/github-actions.md).
