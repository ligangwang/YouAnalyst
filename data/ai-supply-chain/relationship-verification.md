# Relationship verification — 2026-09-24

`relationship-verification.json` marks well-established AI supply-chain relationships as verified and fills coverage gaps around NVIDIA, TSMC, AMD, Broadcom, the hyperscalers, Micron, SK hynix and Samsung. Every relationship has a public source.

## Verification rule

A relationship shows **✓ Verified** on company pages only when all of these hold:

1. A fact is `DOCUMENTED` (it describes something that exists at the source date). Announced or planned activity is never verified; it keeps the "announced / planned" label.
2. At least one of the fact's sources was published by **one of the two companies**: its SEC or exchange filing, investor-relations or newsroom release, or an official product/engineering page. Each source records its `publisher` and the validator rejects a verified fact without a first-party source.
3. The https link passes `--check-links` (no 404/410 or network failure) on the review date. Sites that block automated requests (401/403/429) are listed for a manual check.

The fact then stores `verificationStatus: "CONFIRMED"` and `reviewedAt` (the batch `asOf`). A relationship's display status comes from its most recent reviewed facts (`relationshipTrust`). Relationships with no reviewed fact show no badge and no review date instead of "Needs verification · Last reviewed: Not recorded". **Needs verification** appears only when an editor explicitly marks a fact `PENDING`.

## Contents

- 20 compute-batch facts (2026-09-15) whose source is first-party are re-marked in place. Scope, sources and summary stay unchanged and no duplicate facts are created.
- 7 seed relationships get a confirmed fact. TSMC and Micron as NVIDIA suppliers now cite NVIDIA's FY2026 Form 10-K. Micron→NVIDIA moves from `ANNOUNCED` to `DOCUMENTED`.
- 15 new relationships:
  - NVIDIA suppliers named in its 10-K: SK hynix, Samsung, Hon Hai and Wistron.
  - Quanta, whose QCT subsidiary builds GB300 NVL72 systems.
  - NVIDIA as supplier to Microsoft, Amazon, Alphabet, Oracle, Meta and CoreWeave. These are first-party deployment sources or CoreWeave's 10-K.
  - TSMC, Hon Hai and Amkor as Broadcom suppliers, from Broadcom's 10-K.
  - Samsung HBM3E for AMD Instinct MI350.
- 5 new company identities in the existing `companies` collection:
  - `US:SKHY`: SK hynix, with Nasdaq ADS and KRX 000660 listings.
  - `ORG:SAMSUNG-ELECTRONICS`
  - `ORG:HON-HAI`
  - `ORG:WISTRON`
  - `ORG:QUANTA-COMPUTER`

  Identity resolution reuses an existing company if one already matches. No new Firestore collection is created.

Not included: Fabrinet is named in NVIDIA's 10-K, but `US:FN` has no public directory status yet. It is also unclear whether Broadcom supplies Google's TPUs; no first-party source names the relationship.

## Source summaries

Each source's `summary` paraphrases the cited passage so reviewers can check it. It is **not a verbatim quote**. For new company identities the summary is stored in the company's graph sources as `excerpt` with `excerptKind: "EDITORIAL_SUMMARY"`. Relationship evidence stores only title, link and dates. No page displays these summaries as a quotation.

## Retired publication procedure

This fixed-batch publication operation is retired. The former GitHub Actions launcher is no longer available. The data, scripts and validation tests are retained as historical maintenance material, not an active publication runbook. Use the current admin research tools for routine work. Reusing this batch requires a newly reviewed operational procedure covering authentication, current evidence, preview approval, before-images, write consistency and post-write verification; do not treat the old batch review as authorization to republish. See [Actions and admin jobs](../../docs/github-actions.md).
