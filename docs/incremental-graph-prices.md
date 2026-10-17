# Persistent graph EOD prices

Graph daily changes use the latest two valid completed trading-session closes,
not a rolling 45-day query. The cache has no time-based expiry. The existing
`collectors` collection holds `_graph_prices_v1` (bucket versions) and
`_graph_prices_v1_<hash>` documents (two closes per company, plus separately
requested event baseline closes). No new collection is introduced.

A request checks one small version document. Warm processes reload only changed
buckets; restarted processes restore persisted buckets. Initial company loading
queries the latest two valid raw closes in descending document-ID order, paging
past malformed or adjusted-only records when necessary. Empty results persist
until a price writer changes that company.

EOD ingestion, historical backfill and raw-close normalization use
`writeCachedPrice`: source mutations, initialized cache updates and change
notification commit atomically. New dates keep only the latest two closes;
corrections replace the corresponding close. Historical corrections invalidate
only potentially affected event baselines; a newer session preserves earlier
baselines. Irrelevant backfills and identical prices do not
invalidate the cache. Failed transactions publish neither price nor cache.

Event returns still need a pre-announcement close. Only companies represented in
an event request that close, using a descending query limited to one valid row.
Those baselines persist and are shared across users/processes; at most sixteen
baseline dates per company are retained. Graph-only loads never query them.

Response metadata is projected from cached inputs on requests so clock-dependent
coverage remains accurate without a source-cache expiry. Company/relationship
graphs and collector metadata use the change-driven cache described in
`change-driven-caches.md`.

Roll out EOD/history producers before the web service. The deployment drain now
also checks the existing US/CN_A EOD queue leases, so old EOD requests finish
before the web creates a persistent cache. Direct Firestore console edits bypass
this writer contract and require explicit cache repair.
