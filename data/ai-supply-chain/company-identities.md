# AI map company identity enrichment

Reviewed 2026-09-13. This batch fills geography and listing metadata for the 129 listed companies already on the map. The three private companies already have reviewed identity fields and are untouched.

`country` describes the country/region of the disclosed business office or corporate headquarters/campus. It is not inferred from the exchange, and is not a claim about incorporation, tax domicile, ownership, or all operating locations. Each row records the exact basis and original source. SEC business addresses supply most US-listed issuers; CNINFO reports supply Chinese office locations. NXP's issuer FAQ, Credo's contact page and Alibaba's corporate FAQ resolve missing or registered-address-only SEC data.

Listings are the verified US or A-share securities represented by existing IDs. SEC's company ticker/exchange directory and CNINFO's issuer directory/disclosures supply the evidence. This is not an exhaustive inventory of secondary listings worldwide. Existing listing records are preserved and new verified records appended without creating duplicate company nodes.

The US catalog previously wrote its provider trading-country value (`United States`) into company `country`. The batch explicitly permits that exact legacy value through `expectedCountry`, records it in review evidence, and rejects any other conflicting country. Future ticker sync writes this provider value as `listingCountry` so it cannot overwrite reviewed company geography.

Publication uses the manual `Publish reviewed company identities` workflow on main. Run `preview` before `write`. It reads exact existing `companies` IDs and names, refuses conflicting/newer metadata, and atomically updates only country, listingStatus, listings and identity review evidence/date. It never creates documents or collections, nor edits profiles, prices, watchlists, descriptions, graph membership or company relationships. The existing map reads these fields after its cache expires (up to approximately ten minutes across server/CDN caches).
