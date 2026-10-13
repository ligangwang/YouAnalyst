# News article analysis

The existing `collect-intelligence-news` worker analyzes every collected
`company_news` article, without headline filtering. Exchange/SEC disclosures are
separate event kinds and are not silently treated as news articles.

The worker fetches publisher articles through the reviewed news-source adapters,
including redirect host checks, PDF text extraction, byte limits and a 60,000
character text limit. It never substitutes a headline for inaccessible full text.
Blocked or oversized articles receive a `fetch_failed` receipt and retry after a
day, without an AI charge.

Analysis runs on GPT-6 Luna using the already configured `OPENAI_API_KEY`. No
additional web-search tool is used. The default AI budget is $5 per UTC calendar
month, overridable with `NEWS_ANALYSIS_MONTHLY_BUDGET_USD` (maximum $100). The
worker reserves a conservative maximum token charge before submitting each
request, then settles recorded usage. Unknown charges retain their reservation.
The cap covers this extraction purpose only, not other AI tasks or infrastructure.

## Company identity matching

Version 2 sends only the article title and full text to the model, with a
names-only relationship schema. The covered-company catalog is never included
in a provider request or its input budget reservation.

The worker builds a local lookup once per run from the existing collection
universe: company IDs, names, localized names, explicit aliases and tickers.
Returned names must occur in the article and match exactly after Unicode,
case and whitespace normalization. Only unique matches receive IDs; collisions,
unknown names and two aliases resolving to the same company remain unresolved.
There is no fuzzy matching, inferred subsidiary-to-parent mapping, or extra AI
call for disambiguation. Provider-supplied IDs cannot override local matching.

Names are identity suggestions for review, not proof of legal identity. Matched
observations still require evidence validation and remain `NEEDS_REVIEW`.
Unresolved relationships retain the returned names and evidence in the saved
analysis. Article request size is independent of the number of covered companies.
Existing version-one receipts remain cached; this change does not trigger a
paid historical reanalysis or introduce any new collections.

## Stored records and review

No new Firestore collections are introduced:

- `events`: a `news_analysis` receipt per canonical article URL holds the full
  fetched text, its hash, version, provider result, bilingual relationship
  descriptions and source event reference. The original news event references
  this receipt through `newsAnalysis`.
- `company_relationships`: source-specific `news:` observations with known
  endpoints and confidence >= 0.7 are created as `NEEDS_REVIEW`. Descriptions in
  English and Simplified Chinese, quotes, URLs, dates and announced/documented/
  terminated status are stored. They do not overwrite existing reviewed edges.
- `collectors`: progress cursor and monthly spending reservations.
- `openai_usage_events`: actual token usage and estimated cost per AI request.

To inspect candidates, query `company_relationships` where
`recordKind == NEWS_OBSERVATION` and `status == NEEDS_REVIEW`; inspect the linked
`events/<analysisReceiptId>` snapshot before using the existing reviewed research
publication workflow. Do not directly mark an observation published: confirm
company identities, direction, evidence scope and state, and merge the evidence
into the canonical reviewed relationship. Acquisitions need publication ontology
support before they can become published map edges.

Unresolved names and lower-confidence observations remain in the analysis result
for later review. Empty results are successful analyses, not failures. Results
must include evidence quotes present in the saved article; invalid output enters
`review_required` and creates no candidate edges. Quotes are evidence for review,
not a claim that the semantic interpretation is correct.

## Repeats, backlog and future extraction

A persisted `requesting` receipt precedes the paid call. Both completed and
uncertain requests block automatic repeats for the same canonical URL. A crashed
or timed-out request requires operator inspection of usage before any retry.
Publisher revisions do not automatically incur another charge; the saved content
is explicitly a dated snapshot.

Each run handles recent news plus a rotating historical page, at most 20 paid
calls within its allotted deadline. Unprocessed work remains for later collector
runs; reaching the spending cap defers paid work until the following month or an
explicit budget change. Progress and failures appear in collector output.

Saved text and versioned analysis receipts are the foundation for future finding
extractors. Product events, financing or other categories are not generated yet;
future extractors can reuse the saved snapshot without downloading it again.

Validation: `npx tsx --test tests/graph/news-analysis.test.ts`.
