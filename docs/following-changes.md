# Following changes — first release

## Coverage and maintenance

Business events are a small, manually reviewed, versioned set in
`src/lib/knowledge-graph/curated-events.ts`. Five source-backed events cover
AMD, Cisco, Anthropic, CoreWeave, NVIDIA, Meta and TSMC. This is not an automated
news monitor or comprehensive market feed. Add an event only after reading its
primary source; maintain English and Chinese summaries together. Keep IDs stable
when correcting evidence so one event cannot appear twice. The current release
requires a normal code review/deployment to change this editorial set.

Supported categories: order, capacity, product progress, partnership change.
`eventDate` is the occurrence or announcement date, never an ingestion timestamp.
Use null if the source does not specify it. `sourceDate` and `collectedAt` remain
separate. Plans must be flagged, contract values are not revenue, and unspecified
customers must not be inferred. An optional relationship ID only binds if both
endpoints appear in the event and the relationship already exists in the graph.
Company-only events never create new graph relationships.

Following business events include direct matches and exactly one supplier/customer
hop. Co-sector, competitor, partnership and technology edges do not propagate
events. Terminated relationships do not propagate them. Other recorded connections
show the relationship evidence link and do not imply financial impact.

The existing authenticated research preview/publish API accepts optional
`verificationStatus` (`CONFIRMED`, `PENDING`, `TERMINATED`) and `eventDate` on each
fact. It retains the source, scope, review date and previous facts. Old evidence
without an explicit status is pending verification; a source publication date is
not proof of current validity. Status labels apply at review, within the fact's
scope. A termination fact must document what ended, not merely a product delay.
No new Firestore collections are introduced.

## Behavior measurement

Existing analytics collection/opt-out rules apply. No user IDs, private follow
lists, source URLs or evidence quotations are sent by these new events.

| Event | Meaning |
| --- | --- |
| `company_follow` / `company_unfollow` | Follow API confirmed the requested state; includes registration continuation |
| `company_event_open` | User opens an update via its title or map action |
| `company_evidence_view` | Opens evidence details or a source / relationship evidence link |
| `company_event_map` | Opens the map from an update |
| `following_return_7d` | Same browser returns on a later UTC day within seven days of its previous tracked visit, after engaging with Following |

The return signal is a rolling same-browser proxy, not authenticated cross-device
cohort retention. It excludes opted-out traffic and counts at most once per UTC
day. Compare follow completion, evidence views and map navigation with this return
signal; do not treat event counts as distinct users.

## Acceptance checks

- Direct and one-hop matching, event deduplication, no two-hop propagation.
- No current-status inference from legacy evidence; termination exclusion.
- Separate occurrence/source/collection dates and planned labels.
- Desktop/mobile source expansion, direct-only toggle and account-change clearing.
- Deep links open the event's source evidence alongside the selected map company.
- Analytics collection gate, opt-out and return deduplication.

Relationship arrows/type redesign, financial cards and validation milestones remain
the second batch. The home page remains the 3D graph.
