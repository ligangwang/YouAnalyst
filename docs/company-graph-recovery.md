# Company graph recovery

Update: the user subsequently authorized deletion of the eight demo companies and
eleven demo relationships from production Firestore. Those records are gone; the
migration marker was retained. Numeric-reference support remains only as a
compatibility path in this recovered library. New company identities should use
Firestore-generated IDs. See `ai-industry-map.md` for the new homepage projection,
which reads the separate SEC extraction dataset and does not recreate demo records.

Recovered and adapted the company repository and graph types from commit
`49c6e34d2587d6fadc350304ac1fdaf691bb0935`, immediately before the April 12, 2026
removal (`113da18`). This is a local, read-only foundation; no public route or UI
imports it yet. No seed migration or deployment hook has been restored.

## Reuse assessment

| Original component | Decision |
| --- | --- |
| Company lookup, prefix search and relationship traversal | Restore with validation and bounded reads |
| Company and graph types | Adapt to document-ID strings and nullable tickers |
| Seed data and migration runner | Leave in Git history; existing data must not be reseeded |
| `/api/company/*`, `/api/graph/*` | Defer until access policy and response contract are selected |
| Old homepage graph UI | Defer; the current product has a separate SEC graph implementation |

Use `getCompanyById` for identity references. `getCompanyByIdOrSlug` is a convenience
lookup with document ID, then exact lowercase ticker, then exact lowercase name
precedence. Duplicate ticker/name matches fail explicitly. Prefix searches depend
on existing `nameLower` and `tickerLower` fields; documents without normalized fields
remain available by ID. A missing ticker is supported but does not itself establish
whether a company is private.

Existing company document IDs such as `"1"` stay unchanged. Numeric and string
relationship references are both read and returned as strings. New opaque IDs are
supported without migration. The document ID is authoritative; the old numeric
`id` field is not required. No automatic company creation or fuzzy identity merge
is performed.

The original `maxNodes` counted edges and could return too many nodes or dangling
edges. The recovered implementation caps actual nodes at 50, includes the center,
and excludes edges with missing/unselected endpoints. Relationship reads use only
single-field queries and require no new composite indexes. More than 200 records
in either endpoint query raises an explicit error; pagination is needed before
using this on larger neighborhoods. Search returns at most 20 companies.

## Data issues before integration

The historical seed labels are inconsistent: TSMC -> Apple is `customer`, while
SK hynix -> NVIDIA is `supplier`. These cannot safely be translated into the newer
`SUPPLIER_OF`/`CUSTOMER_OF` ontology by label alone. Seed confidences and weights
are manually entered values, not verified financial exposure estimates. Preserve
the raw labels/source and review individual relationships before combining datasets.
Absent provenance or creation dates remain null rather than being fabricated.

The SEC extraction pipeline (`src/lib/company-graph`) continues to use
`company_graph_edges` and its existing behavior is unchanged. A future integration
should add reviewed company-ID references to named company endpoints while leaving
category targets (e.g. "content licensors") as categories. It should preserve filing
evidence and avoid assuming that a ticker, name or acronym uniquely identifies a company.

Recommended next step: an internal review view that shows stored company identities
alongside suggested SEC-edge matches and supporting evidence. Validate those matches
before introducing a public combined industry graph. The original unauthenticated
Admin SDK routes should not be restored wholesale: current collection rules permit
signed-in client reads, and Admin SDK handlers must enforce their own access policy.

## Validation

Run `npm run test:graph`, `npm run lint` and `npm run typecheck`.
Tests use an injected, read-only Firestore double and need no credentials or network.
They cover mixed legacy/new IDs, ticker ambiguity, private-company shape, node limits,
dangling relationships, invalid data, duplicate queries and bounded neighborhoods.
They do not validate live Firestore query/index execution. No production writes or
live migrations are part of this recovery.
