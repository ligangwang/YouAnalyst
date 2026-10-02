# Live mainland adapter verification

On 2026-10-02 the public, unauthenticated CNINFO topSearch and announcement POSTs
returned native JSON successfully. The organisation identifiers were verified
against exact A-share stock codes and Chinese issuer names. The adapter rechecks
them each run and fails closed if they change.

`verification.json` records the complete discovery window, page/announcement
counts, and full PDF byte hashes. All nine original PDFs were downloaded afresh,
converted with `pdftotext -layout`, resolved by `makeCnEarningsPlan` without
historical plans, and extracted using `extractEarnings`. All eight actual revenue
and reported YoY values, and the Longsys forecast's revenue endpoints, matched the
existing factual expectations. H1 stays January–June cumulative. No Q2 values were
derived. The latest full results found in this window were H1 2026.

`layouts.json` contains only small factual table excerpts from those PDFs. Unit
tests wrap these in synthetic document scaffolding and explicitly identify it as
such. The original full PDF bytes and text are not committed. Preliminary results
are tested with an explicitly synthetic title/layout variant; this discovery
window contained no supported preliminary filing to validate live.

Supported shapes are the standardized main accounting-data table with exactly
current-period revenue, prior-year revenue, and reported growth columns, or the
reviewed Longsys-style forecast range table. Row `营业收入（元）` in the mainland
Shenzhen standardized table uses the reviewed CNY convention; Shanghai tables
require their literal nearby currency/scale declaration. Conflicting currency,
recast/extra/reordered columns, missing units, summaries, annual/Q3 reports,
unreviewed formats and scanned PDFs remain `review_required`. Segments and
standalone Q2/Q3/Q4 calculations are outside this adapter.

## Access boundaries

CNINFO identifies itself as the Shenzhen Stock Exchange official disclosure site:
https://www.cninfo.com.cn/

The native endpoints inspected were:
- https://www.cninfo.com.cn/new/information/topSearch/query
- https://www.cninfo.com.cn/new/hisAnnouncement/query

Success through the public website is evidence of current technical access, not a
licence or blanket permission to automate or redistribute content. CNINFO also
advertises separate data/API services. This change creates no account, accepts no
agreement, and claims no commercial data licence. There was no CAPTCHA or login
in the inspected public flow; no access restrictions were bypassed.

The requester bounds each JSON response to 1 MiB (maximum configurable 2 MiB),
timeout to 15 seconds (maximum 30), redirects to at most two 307/308 responses
within the two reviewed HTTPS endpoints, and discovery to at most 20 pages in a
366-day window. Default discovery is 10 pages. It stops a host for the run after
403/429/network/timeout and makes Retry-After available to a durable cooldown
callback. It never retries blocks. Production injects a durable earnings gate
shared by earnings discovery and document downloads; the separate legacy
fundamentals requester retains its local limit. Instance-local spacing alone is
insufficient across earnings replicas. PDF byte
limits, HTTPS host allowlisting, Poppler invocation and raw persistence belong to
the collector's separate document transport.
