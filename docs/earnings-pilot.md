# US and mainland-China earnings pilot

This is an **offline, read-only proof of the earnings path**, not an activated
collector. It covers NVIDIA, AMD, Microsoft, Alibaba's US-listed ADR, SMIC,
Longsys, Cambricon and Zhongji Innolight. No Firestore collection, topic,
subscription, schedule, IAM binding, paid-data account or AI credential is added.
The existing annual fundamentals models and strict SEC filing event are unchanged.

## What is implemented

1. Injection-only orchestration connects discovery sources, bounded raw downloads,
   reviewed plans and idempotent staging, preserving prior state on failures.
   Pure discovery adapters accept raw SEC submissions rows (before the existing
   scanner's financial-form filter),
   resolve EX-99 exhibits from an actual filing index, and parse paginated CNINFO
   announcement responses. Their transport is injected; there is no duplicate SEC
   poller. Incomplete/repeated pages and issuer mismatches fail closed.
2. A raw-document envelope hashes original bytes and normalized text separately,
   preserves source identity/URL and source-date precision, and distinguishes a
   full capture from a factual excerpt. HTML table rows remain intact. Raw PDF
   replay invokes installed Poppler `pdftotext -layout`; scanned PDFs/OCR are not
   supported. A supplied PDF-text comparison must match fresh extraction.
3. Reviewed per-source **extraction plans** select exact period/unit/header/row
   evidence. They do not contain expected numeric results. Ambiguous rows, unit
   mismatches, incompatible durations and missing evidence require review.
   This is a bounded adapter approach, not a universal earnings parser. A new
   document or changed format requires a reviewed plan before it is accepted.
4. Records contain stable source/event/revision IDs, fiscal periods and evidence,
   native currency/scale, accounting basis, segment labels, actual/preliminary/
   forecast classification, and separately labelled guidance target periods.
   US primary records in this pilot require quarterly evidence; adding a valid
   six-month date range cannot relabel a quarterly observation. Exact guidance
   dates remain null when only fiscal year/quarter is disclosed.
   Midpoint/tolerance guidance preserves the point and labels calculated bounds.
5. A local immutable replay ledger demonstrates duplicate delivery, outbox retry,
   version history and explicit correction links. It is not a production store.
   A correction whose predecessor is missing is blocked, not silently dropped.
   Outbox delivery is at least once: a later failure can replay earlier published
   revisions. Every downstream consumer must deduplicate `revisionId`.

## Reproduce

With existing repository dependencies installed:

```sh
node --import tsx scripts/replay-earnings-pilot.ts --dry-run
node --import tsx --test tests/securities/earnings-pilot.test.ts tests/securities/earnings-review.test.ts
```

The command emits JSONL to stdout and makes **zero network requests or external
writes**. `--dry-run` is mandatory; there is no apply/live mode.

To replay an original source file acquired separately from its verified manifest
URL, supply its matching manifest and exact bytes. The raw-byte hash is checked
before the reviewed raw adapter runs:

```sh
node --import tsx scripts/replay-earnings-pilot.ts --dry-run \
  --manifest=tests/fixtures/earnings/cn/longsys-h1-2026.json \
  --document=/path/to/longsys-h1-2026.pdf
```

For HTML, use the corresponding `us/*.replay.json` and original HTML. Original
PDF/HTML documents are intentionally not committed or redistributed. `*.raw.plan.json`
selects the full-source path; `*.plan.json` selects a compact factual fixture.
A changed source hash requires explicit adapter review; it is not treated as a
successful new report with an old mapping.

## Corpus and verified scope (2026-10-01)

- Sixteen actual-results records: the last two disclosed completed periods for
  each of the eight issuers, plus a real Longsys H1 2026 forecast (17 inputs)
- NVIDIA: fiscal 2027 Q1/Q2; AMD: fiscal 2026 Q1/Q2; Microsoft: fiscal 2026 Q3/Q4;
  Alibaba: fiscal 2026 Q4 and fiscal 2027 Q1
- A-share issuers: calendar 2026 Q1 and H1. H1 is **six months**, never Q2
- All 17 compact factual inputs verify native revenue, reported growth when
  available, period identity and classification. US fixtures include selected
  segment/guidance facts with per-metric source attribution
- Revenue/growth extraction was additionally replayed against the full original
  bytes of 15 documents: the nine mainland documents (including the forecast),
  four AMD/NVIDIA releases and two Alibaba PDFs
- Microsoft original raw replay is **not verified**. Its official rendered-page
  fixtures are clearly labelled excerpts; this is not raw HTML parser coverage
- Full-document replay does not claim complete segment/guidance extraction. The
  compact corpus proves those schema cases; unsupported fields say `not_extracted`
  rather than pretending the issuer did not disclose them
- Corrected-delivery/out-of-order cases are labelled synthetic tests. The reviewed
  sources also contain a real NVIDIA comparative market-platform recast, which
  must not be mistaken for a corrected/replacement Q1 earnings release

These are finite-corpus checks, **not** a claim of market-wide discovery recall,
95% production extraction coverage, low-latency alerting or live reliability.
There is no automatic quarter calculation from YTD and no analyst-consensus or
beat/miss dataset. Original segment groupings and source versions stay separate;
NVIDIA market platforms are not automatically reportable segments. Alibaba's
June-quarter segment taxonomy differs from its March-quarter taxonomy.

## Production integration boundary

The independent SEC/graph migration was merged in PR #808. This pilot is rebased
onto its merge commit `219b1c74d817ecc7b5c5d685fdd8134c7f1030f7`; no production
earnings transport or consumer is connected by this change. Before activation:

- PR #808 interface reviewed against its merged commit (unchanged from reviewed
  head `03f37d22787617edc1cdeeb73aba9c45b4c365ef`): `SecFilingsSource.submissions()`
  and `archive()` return already-filtered financial forms, so they are **not**
  directly compatible with this pilot's raw submissions adapter. First expose a
  coordinated raw/form-neutral scanner view while reusing the existing shared
  SEC HTTP budget. Then emit a separate earnings-source contract. Do not widen strict
  `sec.filing.discovered` while its fundamentals consumer accepts every form
- SEC `8-K` Item 2.02 and `6-K` exhibits are candidates, not automatic evidence of
  earnings. Keep periodic filings as reconciliation/fallback. Acceptance time,
  source publication time, announcement date and collection time are distinct
- Reuse CNINFO transport/identity lookup, with overlap-window polling, complete
  pagination, bounded retries and durable checkpoints. Publication metadata is
  date precision where a true publication instant is not established
- Approve exact persistence destinations before creating collections; atomically
  persist raw references, normalized record and outbox before input acknowledgement
- Add source-specific permitted-access checks, rate budgets, 403/429 cooldowns,
  retention, coverage inventory, reconciliation and operational monitoring
- Activate no HKEX scraper. Broad HK-only coverage requires an approved issuer-IR
  adapter or permissioned/licensed source

## Primary-source references

- [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC fair access and feeds](https://www.sec.gov/about/developer-resources)
- [Form 8-K](https://www.sec.gov/files/form8-k.pdf)
- [Form 6-K](https://www.sec.gov/about/forms/form6-k.pdf)
- [CNINFO official disclosure site](https://www.cninfo.com.cn/new/index?lang=zh)
- [CNINFO data service](https://webapi.cninfo.com.cn/)
- [HKEX access terms](https://www.hkex.com.hk/Global/Exchange/Terms-of-Use?sc_lang=en)

Every fixture carries its direct issuer/disclosure URL and provenance. See the US
fixture README for sources spanning release, filing and official call transcript.
