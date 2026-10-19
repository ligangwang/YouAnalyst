# Fundamentals ID cutover

Company documents in `company_fundamentals` now use the same IDs as `companies`:
`US:NVDA`, `XSHG:688041`, etc. US provider arguments and existing Pub/Sub version-1
messages still use raw tickers. Operational document IDs remain unchanged.

Both scheduled fundamentals jobs select published companies directly with the
supported themeIds query, then filter by listing market. They no longer load the
graph, relationships, or graph valuations to build their scope. US scheduled
market-cap updates also use this selected list rather than scanning fundamentals.
The US worker still drains previously queued explicit requests, including those
outside scheduled theme coverage; this preserves already-requested work.

The one-time legacy-ID copy runner has been retired. Its implementation and original procedure remain in Git history. Current readers and writers use canonical company IDs; removing the runner does not delete legacy production documents.

A future recovery must reconcile any legitimate updates made after the cutover before restoring older data or code. Keep the serving website available throughout recovery.

The standalone full market-cap refresh now pages only the `US:` document-ID range. This excludes
operational receipts and CN records from that scan; it still reads each US company
once per refresh. It does not eliminate all periodic reads or quantify project-wide
savings. US pending-work queries also use the canonical ID range, so retained legacy copies
do not inflate the queue or its remaining-work count.
