# Static industry catalogs

Companies store `taxonomy`, `classification: string[]` (assigned codes, not ancestor paths), and existing provenance metadata. `catalog.ts` resolves display names and ancestor paths in memory. It accepts the old object-path representation during a rolling migration. No Firestore queries are needed for taxonomy lookup.

`sic-bilingual.json` covers all 445 codes in the existing SEC issuer catalog and their verified SIC ancestors (761 nodes). This is **not the entire 1987 SIC manual**. Standard hierarchy comes from the [OSHA SIC manual](https://www.osha.gov/data/sic-manual); SEC aggregate/extension entries retain their reported codes. Aggregates connect to their corresponding standard category. Explicit extensions are distinguished by `level: secExtension`; special reporting codes 8880, 8888 and 9995 remain roots, without an invented industry ancestry. SEC provider text for 1220 incorrectly said “Silver Ores”; the static category uses the verified coal classification without changing any company code.

`cni-bilingual.json` contains the 284 categories and parent links represented in the existing official CNI company-directory snapshot, covering all 5,201 classified A-share records at migration planning time. This is a directory-derived catalog, not a claim to include every unassigned category in the CNI standard. Its original Chinese labels and hierarchy are retained.

SIC Chinese labels and CNI English labels are YouAnalyst editorial translations, not official translations from the source agencies. Source-language names are retained in `name`; UI labels use `translations.en` / `translations["zh-CN"]`.

Catalog additions must include both translations, source verification, valid parents, and a new version. Importers reject unknown codes instead of storing unresolved classifications. Classification metadata records the assignment source; translation-only changes do not update company documents. Do not alter a company's assigned code based on a translation or SIC–CNI mapping.

Rollout: deploy the dual-format reader and code-only importers before applying `scripts/migrate-classification-codes.ts`. Keep the old format readable until snapshots and caches have refreshed. `company_directory` remains a raw source snapshot; this migration changes only `companies`.
