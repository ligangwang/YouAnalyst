# Initial intelligence payload

The homepage server render embeds a compact snapshot when it is ready within the HTML budget. The browser reuses that fresh feed and graph without an immediate duplicate request. Slow reads release the HTML to parallel graph and compact-feed loaders. An embedded graph never triggers another bootstrap.

The browser opts into `graph=omit&payload=compact` on its initial feed request. This response carries graphVersion and the first 20 detailed events, while retaining the complete sourceDocuments facts, coverage and source totals. Legacy API callers retain the complete response unless they explicitly opt in. No persisted schema changes are involved.

Graph and feed bootstrap requests run in parallel. The browser only combines a graph-free feed with a graph of the same version, fetching a replacement when necessary. Older scopes/themes are fenced by the existing cancellation checks. Feed polling and scope updates omit the graph too.

Period/source/sector/watchlist filters, company/search scopes, deep links and Show more request the complete event set on demand. Totals continue using the complete source-document facts. During expansion the event pane shows its pending/error state; it cannot imply the first page is the whole filtered result. Existing previous-day loading remains available.

Baseline production measurements on November 6, 2026: graph payload 3,911,927 decoded bytes; feed 5,803,745 decoded bytes including that graph, 1,669 events and 1,651 source documents. Combined API payload was approximately 9.7 MB decoded, approximately 1.6 MB transferred with compression. Three fresh desktop graph mounts took 10.4–17.6 seconds; a normal cached refresh took 12.4 seconds. These local Playwright measurements are not a representative user benchmark. Candidate and post-release timings are recorded separately during rollout.
