# Company collection names

The authorized company stores are `companies` and `company_relationships`.
All runtime search, directory, sitemap, research and AI-map readers and writers use these names.
Ask the owner before introducing any additional Firestore collection.

## Exact-copy release

`scripts/rename-company-collections.ts --write` copies the former
`market_companies` and `market_company_relationships` collections before production
deployment. It retains document IDs, native Firestore values and subcollections.
It does not normalize profiles, refresh research, rewrite embedded references,
or delete the originals. Existing target documents must match exactly;
unrelated records or conflicting values stop the release.

The script patches only the recognized `companies` access block in the current
live security rules to retain server-only access. It saves the previous rules
and refuses unfamiliar rules instead of replacing the entire deployed ruleset
with a local file.

The existing `directory_syncs/company_collection_names_v1` document records
verification. It is a document in an existing collection, not a new collection.
After production smoke tests, `--verify-source` checks that the old data did not
change during cutover and that production reports the new storage name. Later
deployments skip the completed copy. Original collections remain recovery copies;
they are not active application stores and must not receive further writes.

## Recovery

The deployment retains `company-collection-rename-<run ID>` for 90 days. Its
`documents.jsonl` contains the original paths and recursively tagged values:
`map`, `array`, `timestamp` (seconds/nanoseconds), `reference` (fully qualified,
including database), `geopoint`, `bytes` (base64), `vector`, and primitive types.
The manifest contains collection mappings, count and a canonical SHA-256 digest.
The original collections are also retained. Do not blindly replay a recovery
copy after cutover: new production records may have changed legitimately.

A concurrent source change stops verification. Keep both copies, inspect the
affected records and reconcile before marking the rename complete or deleting
anything. Never overwrite a differing destination during a retry.
