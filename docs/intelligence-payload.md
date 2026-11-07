# Initial intelligence payload

The homepage server render embeds a compact snapshot when it is ready within the HTML budget. The browser reuses that fresh feed and graph without an immediate duplicate request. Slow reads release the HTML to parallel graph and compact-feed loaders. An embedded graph never triggers another bootstrap.

The browser opts into `graph=omit&payload=compact` on its initial feed request. This response carries graphVersion and the first 20 detailed events, while retaining the complete sourceDocuments facts, coverage and source totals. Legacy API callers retain the complete response unless they explicitly opt in. No persisted schema changes are involved.

Graph-bearing server props and browser bootstrap requests use the lossless `columns-v1` graph transport. Each node, relationship and source table sends field names and distinct values once, followed by rows of dictionary indices (`-1` means an absent property). This removes repeated theme metadata and field names without dropping descriptions, evidence, translations or search fields. The client restores the ordinary graph before existing workspace logic runs, and the original graphVersion remains authoritative. API callers opt in with `graph=compact`; the default response stays compatible with existing clients. Feed updates still omit the graph entirely.

The graph view starts its shared dynamic 3D import from a client component outside the server snapshot Suspense boundary. Browser-only loading starts the same import while graph/feed requests are pending. The rendered graph reuses that import; direct table/tree/hierarchy visits retain lazy loading. Failed preloads are observed and clear the pending loader so a later render can retry.

November 7, 2026 graph sample: 3,912,203 decoded bytes becomes 2,550,018 bytes; gzip at the same settings drops from 687,836 to 640,805 bytes. Full graph round-trip equality is verified, including source facts. Three fresh desktop baseline graph mounts were 4.308, 8.322 and 4.002 seconds (median 4.308 seconds). Production candidate and public after-release measurements are recorded separately under the release worktree's output directory.

Graph and feed bootstrap requests run in parallel. The browser only combines a graph-free feed with a graph of the same version, fetching a replacement when necessary. Older scopes/themes are fenced by the existing cancellation checks. Feed polling and scope updates omit the graph too.

Period/source/sector/watchlist filters, company/search scopes, deep links and Show more request the complete event set on demand. Totals continue using the complete source-document facts. During expansion the event pane shows its pending/error state; it cannot imply the first page is the whole filtered result. Existing previous-day loading remains available.

Baseline production measurements on November 6, 2026: graph payload 3,911,927 decoded bytes; feed 5,803,745 decoded bytes including that graph, 1,669 events and 1,651 source documents. Combined API payload was approximately 9.7 MB decoded, approximately 1.6 MB transferred with compression. Three fresh desktop graph mounts took 10.4–17.6 seconds; a normal cached refresh took 12.4 seconds. These local Playwright measurements are not a representative user benchmark. Candidate and post-release timings are recorded separately during rollout.
