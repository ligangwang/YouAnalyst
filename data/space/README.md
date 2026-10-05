# Space company set

Reviewed on 2026-10-04: 31 canonical companies. Each company has a primary role and optional secondary roles. Membership is not a commercial relationship, a revenue estimate or proof that a planned system is operating.

| Company / canonical ID | Primary sector | Secondary roles | Reviewed source |
|---|---|---|---|
| Rocket Lab Corporation / `US:RKLB` | Launch & transport | Components & subsystems, Spacecraft manufacturing | [Company source](https://rocketlabcorp.com/about/about-us/) |
| Redwire Corporation / `US:RDW` | Components & subsystems | Space infrastructure & services | [Company source](https://redwirespace.com/) |
| Moog Inc. / `US:MOG.A` | Components & subsystems | Spacecraft manufacturing | [Company source](https://www.moog.com/markets/space/) |
| Microchip Technology Incorporated / `US:MCHP` | Components & subsystems | — | [Company source](https://ir.microchip.com/news-events/press-releases/detail/5/radiation-tolerant-dc-dc-50-watt-power-converters-provide-high-reliability-solution-for-new-space-applications) |
| Advanced Micro Devices, Inc. / `US:AMD` | Components & subsystems | — | [Company source](https://www.amd.com/en/products/adaptive-socs-and-fpgas/versal/space-grade.html) |
| Teledyne Technologies Incorporated / `US:TDY` | Payloads & instruments | Components & subsystems | [Company source](https://www.teledynespaceimaging.com/en-us/Products_/Pages/default.aspx) |
| L3Harris Technologies, Inc. / `US:LHX` | Payloads & instruments | Spacecraft manufacturing, Ground systems & terminals | [Company source](https://www.l3harris.com/capabilities/space) |
| Lockheed Martin Corporation / `US:LMT` | Spacecraft manufacturing | Payloads & instruments | [Company source](https://lockheedmartin.com/en-us/products/lm400.html) |
| Northrop Grumman Corporation / `US:NOC` | Spacecraft manufacturing | Space infrastructure & services | [Company source](https://www.northropgrumman.com/what-we-do/space/space-logistics-services) |
| Firefly Aerospace Inc. / `US:FLY` | Launch & transport | Spacecraft manufacturing, Space infrastructure & services | [Company source](https://investors.fireflyspace.com/) |
| Gilat Satellite Networks Ltd. / `US:GILT` | Ground systems & terminals | — | [Company source](https://www.gilat.com/markets/land/) |
| Kratos Defense & Security Solutions, Inc. / `US:KTOS` | Ground systems & terminals | — | [Company source](https://www.kratosspace.com/virtual-ground/openspace-architecture) |
| Viasat Inc. / `US:VSAT` | Satellite operators | Ground systems & terminals | [Company source](https://www.viasat.com/about/) |
| Iridium Communications Inc. / `US:IRDM` | Satellite operators | — | [Company source](https://www.iridium.com/network) |
| Globalstar, Inc. / `US:GSAT` | Satellite operators | Ground systems & terminals | [Company source](https://www.globalstar.com/) |
| AST SpaceMobile, Inc. / `US:ASTS` | Satellite operators | Spacecraft manufacturing | [Company source](https://ast-science.com/how-it-works/) |
| Amazon.com, Inc. / `US:AMZN` | Satellite operators | Spacecraft manufacturing, Ground systems & terminals | [Company source](https://www.aboutamazon.com/what-we-do/devices-services/amazon-leo) |
| PLANET LABS PBC / `US:PL` | Data & applications | Satellite operators | [Company source](https://docs.planet.com/data/) |
| BlackSky Technology Inc. / `US:BKSY` | Data & applications | Satellite operators | [Company source](https://ir.blacksky.com/overview/default.aspx) |
| Spire Global Inc. / `US:SPIR` | Data & applications | Spacecraft manufacturing, Ground systems & terminals, Satellite operators | [Company source](https://spire.com/space-services/) |
| Intuitive Machines, Inc. / `US:LUNR` | Space infrastructure & services | Spacecraft manufacturing | [Company source](https://www.intuitivemachines.com/missions/lunar) |
| 中国卫星 / `XSHG:600118` | Spacecraft manufacturing | — | [Company source](https://big5.sse.com.cn/site/cht/www.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-04-22/600118_20260422_HWC8.pdf) |
| 航天电子 / `XSHG:600879` | Components & subsystems | Ground systems & terminals | [Company source](https://www.spacechina.com/n25/n142/n162/n4623/index.html) |
| 中国卫通 / `XSHG:601698` | Satellite operators | — | [Company source](https://www.chinasatcom.com/) |
| *ST航图 / `XSHG:688066` | Data & applications | Satellite operators | [Company source](https://www.piesat.cn/) |
| SpaceX / `ORG:SPACEX` | Launch & transport | Spacecraft manufacturing, Satellite operators, Ground systems & terminals | [Company source](https://www.starlink.com/technology) |
| Blue Origin / `ORG:BLUE-ORIGIN` | Launch & transport | Space infrastructure & services | [Company source](https://www.blueorigin.com/new-glenn) |
| CesiumAstro / `ORG:CESIUMASTRO` | Payloads & instruments | Spacecraft manufacturing, Ground systems & terminals | [Company source](https://www.cesiumastro.com/mission-systems) |
| Axiom Space / `ORG:AXIOM-SPACE` | Space infrastructure & services | — | [Company source](https://axiomspace.com/axiom-station) |
| Varda Space Industries / `ORG:VARDA-SPACE` | Space infrastructure & services | Spacecraft manufacturing | [Company source](https://www.varda.com/platform) |
| D-Orbit / `ORG:D-ORBIT` | Space infrastructure & services | Spacecraft manufacturing | [Company source](https://www.dorbit.space/) |

Company records and existing AI/Robotics memberships stay intact. Enrollment uses the existing `companies` collection and the existing single-field array index. All collection jobs use the shared published-membership union; US disclosures require verified SEC identities, Chinese issuers use the exchange path, and other companies use supported official-news adapters. There are no invented SEC/China filings for other markets.

News availability is explicit: only publisher feeds with dated, approved-host articles are enabled. Unsupported feeds remain uncovered rather than reporting zero new events as complete coverage. Schedules remain hourly on weekdays.

Private-company listing status is not inferred from a company ID; unverified identities retain `UNKNOWN` until separately verified. No valuation or funding figure is invented.

## Deployment

`scripts/migrate-space-theme.ts` previews by default. Supply an explicit cloud project and use `--write` only for the reviewed rollout. It backs up existing company and relationship documents, checks the 134-company AI universe, stops on identity/editorial conflicts, writes atomically with update-time/exists preconditions, and verifies prior fields and theme decisions are unchanged. Reruns are idempotent.
