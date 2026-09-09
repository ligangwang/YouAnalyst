# Insider value review holds

Implemented as the first item from the September 9 website review. This change is local until deployed; it does not migrate or rewrite existing Firestore documents.

## Behavior

- Preserve finite reported prices, including suspicious ones. Flag the five observed IHT sale filings using accession numbers and a fallback ticker/filing-date/direction key.
- Return `valueQuality` and `valueQualityReason` with public and operational transaction responses. For held values, `valueUsd` is null and the company/operations UI displays “Under review.” Filing links remain available on company pages.
- Apply assessment during ingestion and on every read. Existing documents with suspect stored totals are protected without a backfill.
- Stop treating the existing aggregate-looking price heuristic as permission to divide the reported price by shares. It now triggers a review hold, preserving the price field. A high unit price by itself does not trigger that heuristic.
- Exclude unavailable prices/quantities and unsafe arithmetic from totals. An unchecked stored total cannot restore eligibility when the price or quantity is missing.
- Exclude an entire ticker/filing-date/direction group when any scanned transaction in it is held or unavailable. This prevents presenting a partial total as a complete summary. The response reports the number of excluded groups and the daily page explains the omission.
- Reject legacy embedded snapshots for known held groups, including base64, raw JSON, and URI-encoded JSON representations. This protects the page, metadata, and social-image paths that share the decoder. Bump the insider share-card version to v4 for newly generated links.

## Evidence and limitations

The August 31 IHT Form 4 (accession `0001493152-26-040902`) reports 25,000 shares and a price of $32,102.45. The former multiplication produced $802,561,250. The rendered SEC form was inspected; the field is anomalous at the source, and a corrected interpretation has not been established. No replacement price is invented.

The other four holds are related production outliers observed during the website review; their underlying filings still require individual review. Registry entries are conservative holds, not declarations that the filing is false. The fallback key withholds the entire daily group, including other transactions in that group.

This is bounded protection, not universal anomaly detection. It does not compare every price with market data, authenticate every legacy share payload, or recover original source fields already overwritten by the former normalization heuristic. The existing latest-transaction scan is bounded, so excluded-group counts describe that scan rather than the entire database. Re-fetch a filing before restoring source provenance for previously normalized records. Already cached previews on external platforms cannot be recalled by a code release.

## Resolving a hold

1. Inspect the source filing, security identity, footnotes, units, and any amendment. Record the accession and evidence supporting an interpretation.
2. Keep raw and interpreted amounts separate if a verified correction is needed. Do not remove a hold solely because a guessed price looks plausible.
3. Add a regression fixture, implement the verified interpretation or revised hold, and update the registry. For a held daily group, resolve all relevant rows before removing its fallback hold.
4. Run `npm run test:securities` and the normal verification checks. Deploy the reviewed change before checking live company pages, rankings, and old share URLs. Database repair/re-ingestion, if needed, is a separate operation.

## Validation

The regression suite covers source-price preservation, old stored values, all five holds, aggregate-price ambiguity, valid high-priced shares, invalid numbers, complete-group exclusion in both input orders, and blocked/valid legacy snapshots. It uses an in-memory read-only Firestore fixture, with no credentials, production access, or writes.

Run `npm run test:securities`. The suite is included in `npm run verify`.

September 9 checks: all eight regression tests, ESLint, TypeScript, and `npm run build -- --webpack` passed. The default Turbopack build failed in the existing Google Fonts fetch (including an HTTP/2 runtime error on retry); no font or bundler configuration was changed. Live deployment and external preview-cache invalidation have not been performed.
