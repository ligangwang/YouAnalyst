# Website improvements — local implementation

September 9, 2026. These changes are local and have not been deployed.

- Insider value review holds preserve source prices, withhold unresolved totals, and exclude affected activity from rankings and share snapshots. See `insider-value-quality.md`.
- 13F comparisons require a complete prior baseline; unavailable comparisons no longer become fabricated NEW holdings. See `thirteen-f-comparison-integrity.md` for rollout requirements and remaining limitations.
- Company pages save directly for signed-in users. Signup completes a requested save before returning; failed saves can be retried without signing in again.
- Mobile exploration defaults to a company list, uses larger controls and text, and hides unnecessary pagination. Mobile navigation has a compact More menu.
- Prediction cards show thesis content and price timestamps. Feed failures provide retry actions without discarding already loaded results.
- Metadata, primary search action, and How it works explain the company research workflow. Institution discovery collapses personal panels, uses more accurate value-change sort labels, and hides dry runs from user digest history.
- Keyboard improvements include a skip link, visible focus, Escape/focus return for navigation menus, and named digest filters.

## Remaining work

The original review remains the backlog, not a claim of completion. Further work includes global map search integration, guided research examples, resilient sitemap generation, loading/performance measurement, source-section linking where supported, password recovery, and broader data-quality observability. Product additions such as research notebooks and comparisons require their own implementation and validation. Production deployment and historical-data repair have not occurred.

Validation uses isolated synthetic browser fixtures; no live accounts or production records are modified. It does not establish production service availability or real-account credential behavior.
