# Admin relationship review

Administrators open `/admin/relationships` from the Admin dashboard. The default queue contains community disputes and corrections. “Extraction validation holds” opens the existing news and SEC filing observation queue from `company_relationships`.

## Review workflow

1. Choose a pending candidate. Read its quotation and linked source; news also includes the saved article text. For filings, open the original filing to check context.
2. Confirm both canonical company identities using the name/ticker search. Correct the relationship direction and type as needed. Filing company names can be unresolved; industry categories cannot be published as company relationships.
3. Review the supported claim, evidence state, event date and scope/limitations. Keep event dates empty when the source does not specify them; planned events can have future dates. Select AI, Robotics and/or Space explicitly. Both companies must already have published membership in each selected theme; this page does not enroll companies.
4. Enter a review note and confirm that the source, identities, direction, scope and evidence state were checked.
5. Preview publication. This shows the canonical direction, all resulting themes and whether evidence will merge with an existing relationship. Approve and publish commits the reviewed result.
6. Alternatively, enter a rejection reason and confirm rejection. Both decisions remain available in the Published/Rejected tabs with evidence, reviewer and time.

The queue scans batches of 30 records; search and source filters apply to the displayed batch. Continue to the next batch when necessary. Publication appears in graph/company views after their existing caches refresh.

## Persistence and concurrency

The community workflow uses the approved `relationship_contributions` collection. No additional provider calls are introduced.

The user explicitly confirmed this collection on 2026-10-21 for community relationship reports/corrections, review decisions, and contribution-credit audit records.

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


## Automatic provisional publication

After news analysis, `scripts/collect-intelligence-news.ts` calls `autoPublishPendingRelationships`. This bounded sweep checks up to 30 pending observations per run, resumes using `collectors/relationship-auto-publication`, and cycles through held candidates again. It uses the existing scheduled collector; no additional scheduler or paid extraction call is needed. Deployment enables future sweeps; implementation tests do not publish production records.

The deterministic policy requires confidence of at least 0.90, two explicit canonical company names, supported relationship language and direction, and a supported shared published theme. It rejects categories, uncertain or negative language, historical/terminated claims and ambiguous asset acquisitions. Planned events remain announced. News must match its saved analysis receipt and original article quotation; filings require a stored original section quotation and an exact, unique company identity. These checks reduce extraction errors without establishing factual certainty.

Policy version 2 also holds passive directional claims for review, including reduced constructions such as “AMD, acquired by Arista”; name order does not establish the grammatical direction. “Powered by” and “built on” remain valid integration language.

Eligible observations publish with `publicationOrigin: AI` and pending verification. Their public labels say “AI-extracted · Not community verified”; the displayed claim uses the source quotation. Existing editorial/community decisions, withdrawals and disputed edges cannot be overwritten by the automatic path. `research_batches/relationship-auto-<hash>` records the policy version and before/after audit. Ineligible observations remain held with reasons visible to admins.

## Community disputes, corrections and credit

Public evidence panels link to `/relationships/review?relationshipId=...`. Signed-in members submit a reason, HTTPS evidence URL and quotation. Corrections also specify endpoints, direction/type, evidence state, claim, limitations and themes. A report immediately flags the relationship; it remains published until review. Membership is required, reports are limited to 10 per member per UTC day, and one member can submit once per relationship version. Duplicate retries do not create additional reports.

`relationship_contributions` stores the member, relationship snapshot/version, proposal, evidence, review decision, before/after audit and credited points. Client Firestore access remains denied; server APIs enforce member ownership for history and administrator access for the queue. Public views expose only opted-in names and points, never private member IDs or report contents.

Admins independently check the evidence and enter a decision note. Accepting a dispute withdraws the edge. Accepting a correction publishes its structured replacement only when both companies already belong to each selected theme. Duplicate canonical edges, stale relationship versions and self-review are rejected. Other reports against a superseded version must be dismissed or resubmitted against the new version.

Accepted corrections retain the submitted source quotation in the relationship's evidence item, so the public evidence response includes the original passage alongside its URL.

Each accepted useful contribution earns **10 contribution points**, atomically with its decision. Dismissals and raw submission volume earn none. Points are recorded under the existing `users.relationshipCredit` field, with the award receipt in the contribution record; repeated/concurrent resolution cannot award twice. Points have no monetary value or publication privileges. Members can see their own totals and report status on the community review page. Public attribution on accepted corrections requires a separate opt-in; private contributors still earn points.

The contribution queries use single-field status/document-ID and member-ID indexes. No bulk migration is required. Existing graph caches refresh on their normal schedule after publication or withdrawal.

Run `npm run test:relationship-review` for policy, transaction, authorization, versioning, privacy and credit tests. Run `npx playwright test --config=playwright.conversion.config.ts relationship-community.spec.ts admin-relationship-review.spec.ts` for isolated desktop/mobile community and admin flows. All fixtures use synthetic sources and identities.
