# Completed company collection rename

The active stores are `companies` and `company_relationships`. Search, profiles,
research, sitemaps and the AI map use these collections. Ask the owner before
introducing any additional Firestore collection.

Production migration completed on 2026-09-13: 23,997 company documents and 158
relationship records were copied with document IDs, raw field types and values
preserved. Full readback and source-stability verification passed, as did
production smoke tests. No security rules or IAM permissions were changed.

Completed company migration/bootstrap scripts and their deployment steps have
been removed. The existing migration completion documents are historical metadata;
deployment no longer reads them. Regular synchronization and research continue.

## Recovery

The original `market_companies` and `market_company_relationships` collections
remain recovery copies. This code cleanup does not delete database records.

The [verified recovery export](https://github.com/ligangwang/YouAnalyst/actions/runs/34727029073/artifacts/10309001008)
is retained for 90 days by GitHub Actions. It contains tagged raw protobuf fields,
a manifest and the owner review of the existing deny-all rules. Historical copy
and verification code remains available in Git at commit `df65762`.

Any future restore must account for legitimate updates made after cutover; do
not overwrite the active collections with a historical export.
