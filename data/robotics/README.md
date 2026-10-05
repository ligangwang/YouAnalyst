# Robotics membership batch

Reviewed 2026-10-04. These 16 memberships reuse existing canonical company records. They are an initial US and mainland-China coverage batch, not a complete global Robotics directory.

| Sector | Companies | Primary source |
| --- | --- | --- |
| Compute & control | NVIDIA (NVDA), AMD (AMD), Qualcomm (QCOM) | [NVIDIA](https://www.nvidia.com/en-us/industries/robotics/), [AMD](https://www.amd.com/en/solutions/robotics.html), [Qualcomm](https://www.qualcomm.com/internet-of-things/applications/robotics-processors) |
| Sensors & vision | Cognex (CGNX), Ouster (OUST), Orbbec (688322) | [Cognex](https://www.cognex.com/products/machine-vision/3d-laser-profilers), [Ouster](https://docs.ouster.com/sensor-docs/overview/welcome), [Orbbec](https://www.orbbec.com/) |
| Motion & mechanics | Inovance (300124), Leaderdrive (688017), Leadshine (002979), MOONS (603728) | [Inovance](https://www.inovance.eu/industries/industrial-robotics), [Leaderdrive](https://www.leaderdrive.cn/), [Leadshine](https://store.leadshine.com/products/fm2-04308-frameless-motor), [MOONS](https://www.moons.com.cn/m) |
| Grippers & tools | Novanta (NOVT) | [ATI, a Novanta company](https://ati.novanta.com/) |
| Software & simulation | Secondary roles for NVIDIA, AMD, Symbotic and Rockwell | See the individual membership sources in the JSON batch |
| Robot manufacturers | Teradyne (TER), Intuitive Surgical (ISRG), ESTUN (002747) | [Teradyne](https://www.teradyne.com/robotics/), [Intuitive](https://www.intuitive.com/en-us/products-and-services/da-vinci), [ESTUN](https://en.estun.com/) |
| Systems integration | Symbotic (SYM), Rockwell Automation (ROK) | [Symbotic](https://www.symbotic.com/solutions/robots/), [Rockwell](https://www.rockwellautomation.com/en-mde/capabilities/advanced-motion-robotics/amr-robot.html) |

One primary sector per membership keeps primary-sector counts additive. Secondary roles are explicitly recorded separately. Intuitive's surgical systems are surgeon-controlled. Teradyne's membership covers its owned Universal Robots and MiR businesses; subsidiaries are not duplicated as public company listings.

The source-controlled `company-memberships.json` is the reviewed migration input. After publication, `companies/{id}.themeMemberships` is authoritative; the JSON is not a second live directory. NVIDIA, AMD and Qualcomm overlap the AI theme, so the initial union is 147 unique companies (134 AI plus 13 Robotics-only additions).

Membership sources establish business participation, not supplier contracts. This batch publishes no Robotics relationship assertions. Existing AI relationships remain unchanged.

All ten US members have configured publisher-owned IR/news feeds and are eligible for SEC filings, earnings discovery, fundamentals and daily prices. All six A-share members are eligible for exchange disclosures, earnings discovery, fundamentals and daily prices. Extracted earnings still require valid issuer identity and supported source layout. Provider failures and missing data remain visible; eligibility is not a claim that every report has been collected or parsed.

The seven newly added US IR feeds were checked live on 2026-10-04. Cognex's relative earnings PDF links are resolved against its verified publisher host. Rockwell's Q4 feed is linked by its [official investor contact page](https://www.rockwellautomation.com/en-us/company/investor-relations/contact.html). Existing poll schedules, source checkpoints, date semantics and 2026 history cutoff are retained. RSS history is limited to the entries supplied by each publisher.
