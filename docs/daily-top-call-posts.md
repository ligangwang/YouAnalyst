# Daily Top Call writing

The internal draft endpoint reuses `OPENAI_API_KEY` and `OPENAI_MODEL` through the existing AI runtime. It creates varied, source-grounded copy for a future X publisher; it does not call X, schedule posts, or change public share buttons.

## Generate a draft

POST `/api/internal/social/top-call` with `Authorization: Bearer <INTERNAL_API_TOKEN>` and JSON `{}`. An optional `date` uses YYYY-MM-DD; default is today's America/New_York date. Use 8:30 PM America/New_York on weekdays for the eventual publisher (`30 20 * * 1-5`).

The endpoint skips until a matching EOD run has completed with current-date prices, prediction marking enabled, no missing/failed prices and no remaining prediction candidates. Existing EOD records lack these new completeness fields, so the first draft requires a new successful EOD run after deployment. Holidays with stale price dates are skipped.

A DRAFT contains text, source facts, model, opening, layout and fingerprint. Repeated requests return the same saved draft; concurrent requests may generate redundant model calls but only one draft is saved. A changed source fingerprint blocks reuse and requires operator review. PUBLISHED means the date is already recorded as published: do not publish again. SKIPPED means no post should be sent. Non-2xx responses must not be published.

The last ten confirmed publications are supplied to the writer. It chooses a supported opening and layout. Dates, cashtag, direction, analyst attribution, call status and the daily/since-entry returns are rendered deterministically. Site nicknames are not assumed to be X handles. Text includes the original call link. The dated full leaderboard is `/daily/calls/YYYY-MM-DD` if additional publisher content needs it.

The writer has up to three attempts to pass repetition, content and conservative length checks plus a separate model review of the opening's factual support. There is no unverified fallback. The semantic model review reduces risk but is not proof of factual correctness; monitor actual drafts after enabling. The length check deliberately counts literal URLs and double-weights non-ASCII characters, so some posts that X would accept are conservatively rejected. Long or missing attribution and missing return data also block generation.

## Confirm an actual publication

Only after X confirms success, the trusted publishing integration must PUT to the same endpoint with `{ "date": "YYYY-MM-DD", "postId": "numeric X post ID", "text": "exact draft text" }`. This atomically records history and marks the draft PUBLISHED. Repeating the same acknowledgement is safe; conflicting IDs or text are rejected. The acknowledgement trusts the authenticated publisher; it is not independent verification against X.

The publisher still needs X account authentication, a per-date publishing lock and uncertain-outcome reconciliation. Draft idempotency alone does not prevent two external publishers from sending the same text. After an X timeout, reconcile the account before resending; after acknowledgement failure, retry acknowledgement with the confirmed ID. Recheck source freshness immediately before sending. No publisher or Cloud Scheduler posting job is enabled by this change.

Data lives in `social_top_call_drafts` and `social_top_call_publications`, using the date as document ID. Both are server-only under existing Firestore rules. The history query uses the normal single-field publishedAt index. Do not record failed attempts as published history.

## Validation

Run `npm run test:social`, `npm run typecheck`, and `npm run lint`. Social tests use mocked OpenAI responses and need no live key or paid requests. Validate deployed draft generation with real Firebase and the existing OpenAI configuration before connecting publication.
