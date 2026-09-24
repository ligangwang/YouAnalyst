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

## Operation

The **Publish reviewed relationship verification** workflow runs from main by manual dispatch only.

1. Local checks: `npx tsx --test tests/relationship-verification.test.ts` and `npx tsx scripts/publish-relationship-verification.ts --validate`.
2. `--check-links` fetches every source and fails on dead links.
3. `--dry-run` resolves company identities and plans every relationship change in read-only transactions. It writes `relationship-verification-preview.json` and `relationship-verification-summary.md`, which lists every relationship with its action (ADD/UPDATE/UNCHANGED), its display status before and after, commercial-status change, facts marked or added, and new source URLs. Review this before writing.
4. `--write` requires the preview file:
   - It refuses to run if the batch, identity resolution or any relationship document changed since the dry run.
   - It writes company identities, then the relationships in one transaction.
   - It then re-plans and asserts that nothing is left to change.

Existing editorial status wins. A withdrawn or duplicate relationship fails the run for review instead of being republished.
