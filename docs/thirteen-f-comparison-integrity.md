# 13F comparison integrity

Implemented locally September 9, 2026. No production reprocessing has been performed.

Missing prior-quarter data no longer implies zero holdings. Change generation requires exactly one canonical prior report marked `holdingsComplete`, with the expected number of distinct positions, matching accession/manager/quarter, and finite nonnegative amounts. Additions-only amendments are not treated as replacement portfolios. An explicitly verified empty report can support genuine NEW positions.

Ingestion clears the completion flag before writing holdings and sets it only after batches and stale-row cleanup finish. This establishes persistence completeness for parsed holdings; it does not independently reconcile every row against the SEC's declared information-table count. Comparisons generated with this check carry `baselineVerified`. Legacy comparisons without that marker are excluded from current company, manager, discovery, follow-activity, and daily-ranking calculations. Missing comparisons are labeled unavailable. Institutional share rendering checks current validated rankings instead of trusting embedded historical snapshots.

## Rollout

Deploy the code, then reprocess prior-quarter canonical filings before the corresponding current-quarter filings, using the existing ingestion workflow. Until that is done, legacy holdings remain visible but their comparisons are unavailable. Recheck representative unchanged, increased, new, sold-out, missing, and amended reports before relying on repopulated rankings. Do not set completion or verification flags manually to restore counts.

This change does not retract previously delivered digests or third-party cached share images. Existing persisted digest history may still contain earlier calculations. Concurrent ingestion and amendment invalidation across previously computed quarters remain operational limitations: a verification flag describes the baseline used when a change was computed, not a continuously revalidated relationship. Reprocess dependent quarters after baseline corrections. A future revision should store explicit baseline accession provenance and validate canonical generations at read time.

Validation: four regression cases cover complete/missing/partial/mismatched/amended baselines, verified empty portfolios, new/increased/sold-out changes, and exclusion of legacy daily-ranking data.
