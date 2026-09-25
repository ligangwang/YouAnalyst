# Public-company valuation coverage

Reviewed on 2026-09-25. The 15 missing public-company caps had share-basis
validation failures, rather than missing prices.

## US common equity

`domestic-share-counts.ts` ties each exception to the issuer CIK and common-stock
symbol. Preferred listings do not prevent the common symbol from using a verified
entity-wide common-share concept, and are never valued with that common count.
GOOGL, DELL and PLTR may use reviewed total common-share balance-sheet facts.
HPE, ORCL, SMCI and DLR use common-share cover facts. Dated reviewed cover totals
fill gaps for CRWV, DDOG, META, DLR, DELL, PLTR and GOOGL; each source URL and date
is retained in the assessment. GOOGL uses its Class A price as an estimate for all
common classes, not a class-by-class sum using different quoted prices.

These observations expire after 365 days and yield to newer approved facts.
Class-specific counts are summed only after reviewing the filing. Preferred
stock, unexercised options, and EPS weighted averages are excluded.

GDS's 2025 annual report discloses 1,603,020,903 ordinary shares as of March 31,
2026, including 48,718,352 reserved for unvested awards. The reviewed eligible
count is 1,554,302,551. Borrowed ADS shares are already excluded from the reported
total and must not be subtracted again. The divisor remains eight shares per ADS.

Version 4 causes existing reviewed domestic and foreign assessments to refresh
once, respecting retry cooldowns.

## A-share evidence

Accelink's September 22 creditor notice describes a future cancellation, not a
completed change: https://static.cninfo.com.cn/finalpage/2026-09-22/1225575735.PDF

Longsys's September 21 notice explicitly retains repurchased shares for employee
incentives, with no issued-capital change. Only this exact reviewed notice is
excluded from pending share-changing events:
https://static.cninfo.com.cn/finalpage/2026-09-21/1225575075.PDF

SSE's September 24 domestic counts are newer than CNInfo's June/July observations:
Goodix 466,036,300 and OmniVision 1,207,264,500, reported to 100-share precision.
The parser uses a newer dated SSE domestic count when CNInfo lags, retaining the
CNInfo H-share component and its source/date separately. OmniVision has
50,741,100 H shares. Same-date disagreements, future snapshots, B-share cases,
and undated SZSE list mismatches still fail closed. A price older than the newer
exchange observation cannot be used.

Deploy both fundamentals workers and the web service. Recalculate existing
records after updating the share assessments/counts; a web deployment alone
does not rewrite cached caps.
