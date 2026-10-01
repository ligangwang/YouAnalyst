# Mainland factual fixtures

Nine compact factual table excerpts were verified against original CNINFO PDFs on
2026-10-01: Q1 and H1 2026 for SMIC, Longsys, Cambricon and Zhongji Innolight, plus
Longsys's real H1 forecast. They are not original complete PDFs. Metadata includes
the original byte SHA-256 and size; original bytes are not committed.

`*.plan.json` maps the factual excerpt. `*.raw.plan.json` maps the corresponding
original PDF after fresh Poppler `pdftotext -layout` extraction. Expected numeric
values live only in the fixture metadata and are assertions, not extractor inputs.
All nine raw PDFs were replayed with exact revenue/range and reported YoY matches.

`discovery.json` contains selected actual announcement-response fields from fully
paginated CNINFO searches (2026-04-01 through 2026-09-30). It is not a complete
announcement-history dump. It includes calendar/disclosure-notice negatives and
both `一季度报告` and `第一季度报告` title variants.

SMIC values are PRC-GAAP CNY thousands in these A-share documents. They are not the
USD/IFRS quarterly release, and should not be merged into it as identical values.
Longsys's forecast uses CNY ten-thousands and refers to an already ended half-year;
it remains forecast, not reported actuals. No synthetic correction is labelled
as an actual issuer notice.
