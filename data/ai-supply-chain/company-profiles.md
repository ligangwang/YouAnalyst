# AI map company profiles

This reviewed batch covers the 132 company IDs on the live global AI map on September 13, 2026: 67 US-listed issuers, 62 A-share issuers and three private companies. It enriches existing `companies` documents; it does not add companies or relationships.

## Sources and scope

- US issuer identities, filing dates and business addresses: SEC ticker directory and issuer submissions JSON. Addresses are labelled **business address**, not assumed headquarters or country of incorporation. The latest 10-Q/10-K is selected by reporting period, then filing date. For nine foreign issuers, recent 6-K filings were inspected for interim financial statements/results; voting results and earnings-date announcements were excluded.
- A-shares: exact stock code and issuer organization ID from CNINFO. The latest full periodic report is used, excluding summaries, audit reports and cancelled announcements. All 62 have 2026 interim reports. Annual reports supplement contact information when the interim report refers back to them; an explicitly restated interim office address takes precedence. CNINFO timestamps use China calendar dates.
- Websites and investor-relations links: issuer reports, official website navigation and official IR pages. Every field retains its source URL. A disclosure archive is labelled separately from an IR page. A missing IR field means no dedicated link was verified for this batch; it is not a claim that the issuer has none.
- Private-company locations: official OpenAI and Anthropic careers pages, and Mistral's European corporate page. Mistral's source establishes France only, so a street address is not invented. No public financial report was found in the checked issuer websites; this is **not** an exhaustive registry search or a claim that private accounts cannot exist. Fundraising news and estimated revenue are not financial reports.

Financial report dates describe reporting periods and publication dates separately. This is a dated source review, not an ongoing update subscription. Existing business descriptions, company identity, country, listing details, graph membership and relationships remain unchanged.

## Publication

`scripts/publish-company-profiles.ts --validate` checks the committed batch without credentials. The **Publish reviewed company profiles** workflow runs on `main` in the production environment. Run `preview` first, then `write` after checking the result. Both modes reread the exact existing IDs and names. Writes use a single transaction, update only `profile`, and reject missing/renamed/non-public companies or a newer existing profile/report. No new Firestore collection is created.
