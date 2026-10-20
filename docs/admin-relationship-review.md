# Admin relationship review

Administrators open `/admin/relationships` from the Admin dashboard. The queue reads existing news and SEC filing observations from `company_relationships`.

## Review workflow

1. Choose a pending candidate. Read its quotation and linked source; news also includes the saved article text. For filings, open the original filing to check context.
2. Confirm both canonical company identities using the name/ticker search. Correct the relationship direction and type as needed. Filing company names can be unresolved; industry categories cannot be published as company relationships.
3. Review the supported claim, evidence state and scope/limitations. Select AI, Robotics and/or Space explicitly. Both companies must already have published membership in each selected theme; this page does not enroll companies.
4. Enter a review note and confirm that the source, identities, direction, scope and evidence state were checked.
5. Preview publication. This shows the canonical direction, all resulting themes and whether evidence will merge with an existing relationship. Approve and publish commits the reviewed result.
6. Alternatively, enter a rejection reason and confirm rejection. Both decisions remain available in the Published/Rejected tabs with evidence, reviewer and time.

The queue scans batches of 30 records; search and source filters apply to the displayed batch. Continue to the next batch when necessary. Publication appears in graph/company views after their existing caches refresh.

## Persistence and concurrency

No new Firestore collections or provider calls are introduced.

- `company_relationships/news:...` and `company_relationships/filing:...` remain observation records. Approval changes their status to `APPROVED`; rejection sets `REJECTED`. Both retain evidence and a `relationshipReview` decision.
- Approval creates or merges a separate canonical `PUBLISHED` relationship. Existing evidence, facts and theme assignments are preserved. Untagged historical relationships retain AI placement. Explicit theme tags are authoritative in the AI graph.
- `research_batches/relationship-review-<hash>` stores a `RELATIONSHIP_REVIEW` audit, actor, input and before/after values. This uses the existing audit collection with a distinct record kind and ID prefix.
- A transaction commits the canonical relationship, candidate decision and audit together. Repeating the same request returns its receipt; conflicting decisions fail.
- Candidate versions and preview tokens detect changed evidence, endpoint membership, existing relationships and date rollover. A stale preview must be regenerated.
- Filing extraction retries preserve reviewed observations. The research batch publisher excludes observation records when locating canonical edges.

Preview and approval use bounded endpoint queries (at most 501 records per endpoint); duplicate canonical identities, oversized neighborhoods and oversized audits require the research reconciliation workflow.

## Authentication and validation

The API independently verifies the Firebase token and administrator role before database access. Responses are private/no-store. Request bodies are bounded to 16 KB and only accept review fields; the server loads evidence from the stored candidate rather than accepting replacement evidence from a client.

News approvals check the saved article hash, source event and quotation against the original analysis receipt. Filing review requires the administrator to verify the linked source. Documented facts receive CONFIRMED review status; announcements remain PENDING; terminated facts retain TERMINATED status. Approval is an editorial decision, not an automated claim of factual truth.

Queries use existing single-field indexes: relationship status plus document ID, relationship source, and the existing company identity search indexes. No migration or bulk data rewrite is needed.

## Validation

- `npm run test:relationship-review`: transactional publication, history, merging/deduplication, stale data, invalid evidence/themes, authorization, rejection, extraction retry and research-batch interoperability.
- `npx playwright test --config=playwright.conversion.config.ts tests/conversion/admin-relationship-review.spec.ts`: isolated desktop/mobile evidence review, publication, rejection, unresolved identities, stale previews and denied access.
- The relationship-review service suite is included in `npm run verify:checks`.

Browser tests use mocked identities and data, and never submit real review decisions.

