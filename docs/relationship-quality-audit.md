# Relationship evidence audit — 2026-09-08

Scope: 77 public company-graph records across NVDA, AMD, MSFT, AMZN, AAPL and QCOM; 59 grouped relationships were visible in the bounded industry API snapshot. Reviewed relationship meaning and direction against the cited annual-report sections. This is an evidence audit at the filing date, not an independent confirmation of present contracts, corporate identity, materiality or revenue exposure. AI confidence scores were not recalibrated.

## Findings and decisions

- Microsoft OEM distribution: reverse three arrows. Dell, Hewlett-Packard and Lenovo distribute Microsoft software. The OEM section explicitly says software is preinstalled on devices the OEMs sell.
- AMD console/PC chips: change three manufacturing claims to supply relationships (Microsoft, Sony Interactive Entertainment, Valve). Designing/supplying semi-custom chips does not establish contract manufacturing.
- AMD–Sanmina: retain the partnership, replacing the sale-only excerpt with the explicit preferred-partner statement in MD&A Overview. The filing also describes a five-year manufacturing services agreement. Do not suppress a valid claim just because its original excerpt was incomplete.
- Amazon China-based sellers: change partnership to customer-of, directed from sellers to Amazon, based on seller-services and advertising revenue.
- Apple licensing: rename the category to technology and IP licensors to match the excerpt. Content licensing exists elsewhere in the filing, but the attached excerpt does not establish that narrower category.
- Withhold three Apple claims: logistics-provider partnership and developer partnership inferred from a generic risk list, plus distribution for a product category (accessories) rather than a counterparty.
- Trim dangling commas/semicolons in display names. Do not automatically merge Samsung with Samsung Electronics, parent/subsidiary entities, or source-scoped mentions. A verified identifier registry remains needed.

## Implementation and limits

Nine amended records and three withheld records are defined in src/lib/company-graph/relationship-reviews.json. Decisions match the full original signature: edge ID, issuer ticker/CIK, accession, target name/type, relationship, direction and quotation. Changed evidence and new filings require fresh review. Raw Firestore data, extraction code, financial calculations and confidence values are unchanged. Read-time decisions are shared by the company API and industry projection; amended industry evidence shows the reason/date. Withheld claims have a separate count from capacity omissions. Unlisted records are not marked as reviewed by the API.

Supplier and competitor can both be valid for the same company in different product markets. Generic categories remain distinct from named companies and are hidden by default. Abbreviated extraction excerpts and old filing dates remain limitations; the SEC source link is authoritative. This change does not add missing counterparties or relationships, backfill filings, or claim that all future extraction output is verified.

Microsoft context was checked against its official annual report because the SEC page exceeded the web reader's size limit: https://www.microsoft.com/investor/reports/ar25/index.html (Business, OEMs). Other sources below are SEC filings. NVIDIA's Manufacturing/Competition, AMD's Semi-Custom/Manufacturing/Competition and MD&A, Qualcomm's Manufacturing/Significant Customers, Amazon's seller and supplier risk sections, and Apple's manufacturing/IP/distribution/risk sections underpin this audit.

## Record inventory

Retained means the relationship classification is consistent with the inspected filing context; it is not a verified identity or current-contract badge. Direction is relative to the filing issuer: target_to_source means the named target acts on the issuer; bidirectional applies to partnership/competition.

### NVDA

Source: [2026-02-25 annual filing](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm)

| Target | Original relationship | Direction | Decision |
| --- | --- | --- | --- |
| Advanced Micro Devices, | COMPETES_WITH | bidirectional | Retained at filing date |
| Huawei Technologies | COMPETES_WITH | bidirectional | Retained at filing date |
| Intel | COMPETES_WITH | bidirectional | Retained at filing date |
| Taiwan Semiconductor Manufacturing | SUPPLIER_OF | target_to_source | Retained at filing date |
| Hon Hai Precision Industry Co., | SUPPLIER_OF | target_to_source | Retained at filing date |
| Micron Technology, | SUPPLIER_OF | target_to_source | Retained at filing date |
| Samsung Electronics Co., | SUPPLIER_OF | target_to_source | Retained at filing date |
| SK Hynix | SUPPLIER_OF | target_to_source | Retained at filing date |
| Fabrinet | SUPPLIER_OF | target_to_source | Retained at filing date |
| Wistron | SUPPLIER_OF | target_to_source | Retained at filing date |
| Amazon, | COMPETES_WITH | bidirectional | Retained at filing date |
| Microsoft | COMPETES_WITH | bidirectional | Retained at filing date |
| Alphabet | COMPETES_WITH | bidirectional | Retained at filing date |
| Alibaba Group | COMPETES_WITH | bidirectional | Retained at filing date |
| Baidu, | COMPETES_WITH | bidirectional | Retained at filing date |
| Broadcom | COMPETES_WITH | bidirectional | Retained at filing date |
| Qualcomm | COMPETES_WITH | bidirectional | Retained at filing date |
| Arista Networks | COMPETES_WITH | bidirectional | Retained at filing date |
| Cisco Systems, | COMPETES_WITH | bidirectional | Retained at filing date |
| Tesla, | COMPETES_WITH | bidirectional | Retained at filing date |
| Hewlett Packard Enterprise | COMPETES_WITH | bidirectional | Retained at filing date |
| Marvell Technology, | COMPETES_WITH | bidirectional | Retained at filing date |
| Ambarella, | COMPETES_WITH | bidirectional | Retained at filing date |
| Lumentum Holdings | COMPETES_WITH | bidirectional | Retained at filing date |
| Renesas Electronics | COMPETES_WITH | bidirectional | Retained at filing date |

### AMD

Source: [2026-02-04 annual filing](https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/amd-20251227.htm)

| Target | Original relationship | Direction | Decision |
| --- | --- | --- | --- |
| Intel | COMPETES_WITH | bidirectional | Retained at filing date |
| Nvidia | COMPETES_WITH | bidirectional | Retained at filing date |
| Taiwan Semiconductor Manufacturing | SUPPLIER_OF | target_to_source | Retained at filing date |
| OpenAI OpCo, | PARTNER_OF | bidirectional | Retained at filing date |
| GLOBALFOUNDRIES | SUPPLIER_OF | target_to_source | Retained at filing date |
| OpenAI OpCo, | CUSTOMER_OF | target_to_source | Retained at filing date |
| Tongfu Microelectronics Co., | PARTNER_OF | bidirectional | Retained at filing date |
| King Yuan Electronics | SUPPLIER_OF | target_to_source | Retained at filing date |
| Microsoft | MANUFACTURES_FOR | source_to_target | The filing describes AMD chips powering consoles, not AMD providing contract manufacturing. |
| Siliconware Precision Industries | SUPPLIER_OF | target_to_source | Retained at filing date |
| Sony Interactive Entertainment, | MANUFACTURES_FOR | source_to_target | The filing describes AMD chips powering consoles, not AMD providing contract manufacturing. |
| Altera | COMPETES_WITH | bidirectional | Retained at filing date |
| Samsung Electronics Co., | SUPPLIER_OF | target_to_source | Retained at filing date |
| United Microelectronics | SUPPLIER_OF | target_to_source | Retained at filing date |
| Lattice Semiconductor | COMPETES_WITH | bidirectional | Retained at filing date |
| Microsemi | COMPETES_WITH | bidirectional | Retained at filing date |
| Valve | MANUFACTURES_FOR | source_to_target | The filing describes AMD chips powering a gaming PC, not AMD providing contract manufacturing. |
| Broadcom | COMPETES_WITH | bidirectional | Retained at filing date |
| Marvell Technology Group, | COMPETES_WITH | bidirectional | Retained at filing date |
| Analog Devices | COMPETES_WITH | bidirectional | Retained at filing date |
| NXP Semiconductors | COMPETES_WITH | bidirectional | Retained at filing date |
| Qualcomm | COMPETES_WITH | bidirectional | Retained at filing date |
| Texas Instruments | COMPETES_WITH | bidirectional | Retained at filing date |
| Sanmina | PARTNER_OF | bidirectional | Replaced the sale-only excerpt with the explicit partnership statement in the same filing (MD&A, Overview). |

### MSFT

Source: [2025-07-30 annual filing](https://www.sec.gov/Archives/edgar/data/789019/000095017025100235/msft-20250630.htm)

| Target | Original relationship | Direction | Decision |
| --- | --- | --- | --- |
| Dell | DISTRIBUTES_FOR | source_to_target | OEMs distribute Microsoft software; Microsoft does not distribute for the OEM. |
| Hewlett-Packard | DISTRIBUTES_FOR | source_to_target | OEMs distribute Microsoft software; Microsoft does not distribute for the OEM. |
| Lenovo | DISTRIBUTES_FOR | source_to_target | OEMs distribute Microsoft software; Microsoft does not distribute for the OEM. |
| third-party manufacturers | MANUFACTURES_FOR | target_to_source | Retained at filing date |
| component suppliers | SUPPLIER_OF | target_to_source | Retained at filing date |
| datacenter component suppliers | SUPPLIER_OF | target_to_source | Retained at filing date |
| device component suppliers | SUPPLIER_OF | target_to_source | Retained at filing date |

### AMZN

Source: [2026-02-06 annual filing](https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/amzn-20251231.htm)

| Target | Original relationship | Direction | Decision |
| --- | --- | --- | --- |
| China-based suppliers | SUPPLIER_OF | target_to_source | Retained at filing date |
| semiconductor suppliers | SUPPLIER_OF | target_to_source | Retained at filing date |
| China-based sellers | PARTNER_OF | bidirectional | The cited revenue is paid for Amazon seller and advertising services; it does not establish a strategic partnership. |
| content licensors | SUPPLIER_OF | target_to_source | Retained at filing date |
| technology licensors | SUPPLIER_OF | target_to_source | Retained at filing date |

### AAPL

Source: [2025-10-31 annual filing](https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm)

| Target | Original relationship | Direction | Decision |
| --- | --- | --- | --- |
| contract manufacturers | MANUFACTURES_FOR | target_to_source | Retained at filing date |
| component suppliers | SUPPLIER_OF | target_to_source | Retained at filing date |
| logistics providers | PARTNER_OF | bidirectional | Withheld |
| content licensors | SUPPLIER_OF | target_to_source | The cited passage establishes technology and intellectual-property licensing, not specifically content licensing. |
| third-party developers | PARTNER_OF | bidirectional | Withheld |
| third-party accessories | DISTRIBUTES_FOR | source_to_target | Withheld |

### QCOM

Source: [2025-11-05 annual filing](https://www.sec.gov/Archives/edgar/data/804328/000080432825000085/qcom-20250928.htm)

| Target | Original relationship | Direction | Decision |
| --- | --- | --- | --- |
| Advanced Semiconductor Engineering | SUPPLIER_OF | target_to_source | Retained at filing date |
| Amkor Technology | SUPPLIER_OF | target_to_source | Retained at filing date |
| Samsung Electronics | SUPPLIER_OF | target_to_source | Retained at filing date |
| Siliconware Precision Industries | SUPPLIER_OF | target_to_source | Retained at filing date |
| Taiwan Semiconductor Manufacturing | SUPPLIER_OF | target_to_source | Retained at filing date |
| Apple | CUSTOMER_OF | target_to_source | Retained at filing date |
| Global Foundries | SUPPLIER_OF | target_to_source | Retained at filing date |
| STATSChipPAC | SUPPLIER_OF | target_to_source | Retained at filing date |
| Xiaomi | CUSTOMER_OF | target_to_source | Retained at filing date |
| Samsung | CUSTOMER_OF | target_to_source | Retained at filing date |

