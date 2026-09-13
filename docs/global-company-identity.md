# Global company identity and research

The existing `companies` collection remains the company master. Do not create
another collection for global or privately held companies.

## Fields

- `country`: verified ISO 3166-1 alpha-2 home jurisdiction. Record the source and
  distinguish incorporation from operating headquarters in research notes. A
  listing market is not evidence of home jurisdiction.
- `listingStatus`: `PUBLIC`, `PRIVATE`, or `UNKNOWN`. This is independent of
  editorial `status` (`DIRECTORY`, `PUBLISHED`, `DRAFT`, etc.). A public benefit
  corporation is not necessarily publicly traded.
- `listings`: `{market, exchange, symbol}[]`; use exchange MIC codes where
  available. Multiple listings may belong to one issuer. Do not merge a parent
  and subsidiary just because they share a domain.
- `identifiers`: `{scheme, value}[]` for verified identifiers (e.g. CIK or
  country-qualified registration numbers). Keep strings to preserve leading
  zeros. CIK matching ignores padding zeros.
- `legalName`, `aliases`, `website`: supplementary matching evidence.

Existing US and A-share IDs remain unchanged. New companies without an existing
record use a reviewed `ORG:` ID that does not depend on a ticker. The graph
groups these under “Global & private”; geography and listings appear separately
in the detail panel and accessible directory. Missing values are unverified,
never inferred from the old market field. Private companies do not enter the
stock-prediction picker.

## Identity review before publication

The manual **Review global company identities** workflow reads the current
`companies` directory and compares `global-company-proposals.json` against it.
It publishes a JSON artifact; it does not write Firestore data. It also reports
overlaps between proposals in the same batch.

Exact IDs and official identifiers can identify an existing record. Multiple
matches, conflicting identifiers/country, names, and domains require review.
`NEW` means no match was found in that snapshot, not proof a company does not
already exist under an unrecorded alias. Review legal identity before creating
it. Never automatically merge records to clear an ambiguous result.

The publisher must recheck the live directory before any write and rewrite
relationship endpoints to the resolved existing company IDs. Evidence and
editorial changes must survive replays; identity review alone does not authorize
publishing a relationship claim.

## Research scope

The current 129-company seed is not a complete global inventory. Global
expansion needs both identity resolution and fresh source review. The first
three proposals were checked against 23,997 live company records on September
13, 2026: no existing or ambiguous matches were found. The sourced first batch
is in `data/ai-supply-chain/global-research.json`:

- OpenAI Group PBC: [official structure](https://openai.com/our-structure/).
- Anthropic: [company information](https://www.anthropic.com/company).
- Mistral AI: [French registration and address](https://legal.mistral.ai/terms/privacy-policy/).

Company identity, publication eligibility, and relationship evidence are three
separate checks. Existing sources do not prove every relationship is still
active; retain announcement/source dates and review changes explicitly.

## Publish a reviewed batch

The manual **Publish reviewed global AI research** workflow runs only from
main, using the production environment. First choose `preview` to inspect
resolved company IDs and canonical relationship IDs. Choose `write` after
reviewing the data PR. Both operations recheck current identities; all writes
are atomic and use only `companies` and `company_relationships`.

The publisher preserves existing profile values and editorial decisions,
including withdrawn relationships, and deduplicates appended evidence.
It is an additive publisher, not an automatic correction tool. Existing
profile corrections require explicit review. Graph caches can take five
minutes to refresh after publication.

The first batch has three companies and five relationships. Company
announcements support every relationship. Forge corroborates private listing
status; its generic IPO-filing FAQ text is stale and is not used. Issuer S-1
announcements take precedence for filing dates. OpenAI's home jurisdiction
also uses Harvard Business Services' incorporation report.

The existing seed's structural audit found 33 of 129 companies with business
connections and 96 with sector membership only. This does not freshly verify
the 31 older connections or make the global map exhaustive. Continue reviewing
those sources and global public/private participants by industry stage.
