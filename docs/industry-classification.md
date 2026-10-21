# Company industry classification

Company assignments reuse `taxonomy` (`SIC` or `CNI`) and `classification`
(an array of assigned leaf-code strings). Static bilingual catalogs supply names
and hierarchy; raw `company_directory` provider records retain their original paths.
Do not infer company SIC assignments from
CNI mappings, or company GICS assignments from the research-topic catalog.
Themes and their reviewed roles remain independent.

The optional `classificationMetadata` object contains:

- `catalogVersion`: exact version of the catalog used to interpret the path.
- `sourceUrl`: the assignment source, independent of a company's general source.
- `sourceSnapshot`: optional publisher snapshot date.
- `observedAt`: ISO observation time, not the assignment's effective date.

The CNI importer writes this object alongside the existing fields in both
`companies` and `company_directory`. Existing documents without it remain
readable. An identical completed source checksum still skips the import;
deployment alone does not rewrite old records or backfill metadata. Changed
imports use the existing `updatedAt` mechanism and flow into company snapshots.

## Versioned JSON catalogs

`src/lib/industry-classification/model.ts` defines and validates catalog and
mapping files. Catalog keys are `taxonomy`, `version`, `sourceUrl`, `nodes`.
Each node contains `code`, `name`, `translations`, `level`, `parentCode`.
Root parents are null. Translation keys are `en` and `zh-CN`; translations
are YouAnalyst display labels, not asserted official translations.

Load and validate catalogs once, retain them in process memory, and derive
parent paths without database requests. Do not put catalogs under `public/`
without checking distribution rights. Versions are immutable.

Export a catalog from a downloaded official CNI directory snapshot:

```sh
npx tsx scripts/export-cni-taxonomy.ts snapshot.json cni-directory-YYYY-MM.json
```

The exporter performs no network or Firestore operations and refuses to
overwrite a file. `cni-directory-YYYY-MM` identifies a catalog derived from
that directory release, not a claimed CNI methodology edition. It includes
categories present in that snapshot, not necessarily every defined category.
Conflicting category names/parents are rejected before import or export.

SIC catalog files use the same format, with levels `division`, `majorGroup`,
`industryGroup`, `industry`. Preserve SEC-specific broad codes rather than
inventing a complete four-level path. SIC data ingestion and official catalog
population are separate from this structure change; no SIC assignments or
cross-taxonomy equivalences have been fabricated.

## Populate US companies from SEC

Run `npx tsx scripts/populate-sec-classifications.ts` with `GCP_PROJECT_ID`,
`SEC_USER_AGENT` and Application Default Credentials configured. It previews
up to 100 `US:` company records. Use `--apply` to write and `--after=US:SYMBOL`
to continue with the successful batch's reported cursor. `--output=PATH`
selects the local report/catalog folder. After an error, repeat the same cursor;
do not advance based on an incomplete plan. Applied records are skipped on replay.

The importer uses SEC's ticker/CIK mapping and validates the submissions CIK.
Missing mappings, missing SICs, conflicting existing CIKs, other taxonomies and
soft-deleted companies are reported without guessing or overwriting. SEC
transport errors stop the batch before company writes. Requests use the shared
SEC gate plus one-second spacing; there are no automatic provider retries.
Dry-run makes no company writes but does use the existing shared rate-gate state.

Each content-addressed catalog preserves SEC-reported codes and names from the
batch. These are partial observed catalogs, not the full SIC hierarchy: special
SEC codes have no invented parent. Company metadata points to the exact issuer
submissions URL; it omits sourceSnapshot because SEC supplies no classification
effective date here. SEC-reported labels may differ from the OSHA manual.

Company writes are spaced one second apart, preserve all unrelated fields, use
server `updatedAt`, and require the document's original update-time precondition.
Concurrent modifications fail the batch rather than recreating or restoring a
company. Existing identical SIC assignments with provenance are not rewritten.
Plans and catalogs are local artifacts; retain their files for the metadata
references. Publish reviewed catalogs to the shared artifact store separately.

### Full-directory bulk import

For the full directory, use SEC's nightly `submissions.zip` from
`https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip` rather
than thousands of individual API requests. Download under the existing SEC
request gate, then run:

```sh
python scripts/extract-sec-classifications.py submissions.zip sec-issuers.json
npx tsx scripts/populate-sec-bulk-classifications.ts --directory=ARTIFACT_DIRECTORY
npx tsx scripts/populate-sec-bulk-classifications.ts --directory=ARTIFACT_DIRECTORY --apply --limit=100
```

The artifact directory must contain `sec-issuers.json` and `companies.json`.
The latter is a Firestore snapshot array of `{id, data, updateTime}`; updateTime
contains exact `seconds` and `nanoseconds`. Prepare it from an authenticated
read of the `US:` document-ID range, retaining each snapshot's updateTime.
The plan is exclusive-created; do not overwrite it while resuming an import.

The bulk index excludes ambiguous ticker/CIK mappings and non-listed historical
issuers. Missing SIC is not inferred. The plan records skipped reasons and the
complete source-derived SIC catalog. `applied.jsonl` records per-company results;
subsequent apply runs skip finished entries. Review conflicts separately against
fresh documents. A crash after a write but before its log entry can appear as a
conflict on replay; inspect the stored classification before planning another write.

Default application is one write per second. After a successful canary and
health checks, `--batch-size=10` allows atomic groups of up to ten, with at least
one second between groups. `--limit` bounds each invocation. Check website
errors and notification capacity between batches; stop starting new batches on
capacity errors. Preconditions apply to every document even within a batch.
No new schedule, collection, or SEC per-pageview requests are introduced.

The repository's `catalogs/sec-sic-observed-*.json` is a content-addressed catalog
of SEC-reported classifications observed on 2026-10-21, not an OSHA hierarchy.

## Many-to-many mapping files

Top-level keys: `version`, `sicCatalogVersion`, `cniCatalogVersion`, `mappings`.
Each mapping contains `sicCode`, `cniCode`, `relation`, `evidenceUrls`,
`reviewedAt`. Relations are `equivalent`, `sic_broader`, `sic_narrower`, `overlap`.
Several mappings may share either endpoint, but each pair appears once.
Validation rejects missing categories, mismatched versions, missing evidence,
duplicate pairs and invalid review dates. An empty mapping list is valid until
reviewed mappings are available. No new Firestore collection is required.


### Shared SEC identity and classification sync

`companies.cik` is a zero-padded ten-digit SEC issuer identifier, shared by multiple listings when applicable. The bulk and online SEC population commands use `secCompanySyncPatch` to update CIK and SIC together and write `updatedAt` once. Missing SIC does not remove existing classification. Missing ticker mappings retain verified existing CIKs; conflicting mappings and invalid stored CIKs require review. Soft-deleted companies are untouched. Unchanged observations produce no writes.

The scheduled SEC filings collector reuses its enrolled-company snapshot and already-fetched submissions response to invoke the same logic. It reads a company again only inside a transaction when a change is needed, protecting concurrent edits. Unknown SIC catalog entries are logged for catalog review. This scheduled path covers enrolled companies; the bulk command is the resync path for the entire US directory. The collector integration requires worker deployment.

For a bulk resync, create a fresh directory with `companies.json` (documents and exact update times) and `sec-issuers.json` from the SEC bulk extraction, then run `scripts/populate-sec-bulk-classifications.ts --directory=...` to prepare a reviewable plan. Apply with `--apply --limit=100 --batch-size=10 --delay-ms=1000`, monitor capacity before continuing, and use a fresh snapshot/plan to retry concurrency conflicts. The append-only results file makes interrupted applications resumable. Generated catalogs must be retained with their content-addressed version.
