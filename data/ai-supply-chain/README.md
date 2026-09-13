# AI industry map storage

The live map reads only:
- `companies/{companyId}`: company identity, description, market, and `aiGraph` sector membership.
- `company_relationships/{relationshipId}`: published company-to-company connections with embedded evidence.

Company IDs are `US:NVDA`, `XSHG:688041`, etc. Relationship IDs are canonical source/type/target keys. Symmetric relationships sort their endpoints.

`aiGraph` contains publication status, sector IDs, bilingual sector labels, membership evidence, display order, and the research date. Sector membership is editorial classification, not a commercial relationship. Business edges preserve documented versus announced status. The API includes public AI members and their directly connected public companies; unclassified neighbors appear under Related companies. Drafts and withdrawn relationships are excluded.

The JSON files are reviewed seed inputs. `scripts/import-ai-knowledge-graphs.ts --write` imports them into the shared collections atomically and preserves existing editorial changes on replay. It does not create a separate graph collection.

The legacy graph migration is complete and its script has been removed. Deployments now read the shared stores directly. Historical migration code is retained in Git at commit `df65762`; see the [completed migration and recovery record](../../docs/company-collection-rename.md) before planning any restore.

The map keeps a five-minute server cache. A fresh page/API request after cache expiry reflects approved shared-store updates.

## Semantics and coverage

`PARTICIPATES_IN` connects a company to an editorial supply-chain stage. It is **not a commercial relationship**. Company-to-company records distinguish documented supply, technology integration, ecosystem partnership, power agreements and planned adoption. Announced adoption is not evidence of completed delivery. Source dates may be historical; `asOf` is the research snapshot date, not the start date of every relationship. Undated sources remain null. Source checking is editorial research, not a separate human approval.

AI exposure is categorized as `DIRECT`, `ENABLER`, or `ADJACENT`; none is an estimate of AI revenue. In particular, general semiconductor materials/equipment and analog or vision chips are not automatically AI-specific suppliers. The graph has gaps in company-to-company relationships, especially A-shares; no line does not imply no relationship. Named parent/subsidiary attribution is retained in summaries. There are no inferred cross-border procurement links.

US security IDs use the `US:` market namespace, not an exchange MIC. A-share IDs match the imported CNI directory. All 62 A-share identities were checked against the 2026-6 snapshot. Listing status is not real-time verified. Everpure is stored as `US:P`, with the issuer's ticker/name-change announcement; the old `PSTG` identity is not reused. No paid model calls are required for this import.


## AI supply chain · US-listed companies

67 companies · 19 stages · 72 stage memberships · 28 company-to-company relationships.

| Company | Symbol | Role | Evidence |
|---|---|---|---|
| ASML | ASML | Lithography systems used to manufacture advanced chips. | [Source](https://www.asml.com/en/company/stories/2026/machines-behind-machines) |
| Lam Research | LRCX | Etch and deposition equipment for semiconductor fabrication. | [Source](https://newsroom.lamresearch.com/how-deposition-and-etch-are-reshaping-chips-for-the-ai-era?blog=true) |
| KLA | KLAC | Process control and inspection for semiconductor manufacturing. | [Source](https://ir.kla.com/news-events/investor-day-2026) |
| Cadence | CDNS | Electronic design automation for advanced chip design. | [Source](https://www.cadence.com/en_US/home/explore/ai-chip-design.html) |
| Arm | ARM | Neoverse processor IP and compute platforms for cloud and AI infrastructure. | [Source](https://www.arm.com/products/cloud-datacenter) |
| Amkor | AMKR | Advanced packaging for chiplets, logic and high-bandwidth memory. | [Source](https://amkor.com/applications/artificial-intelligence/) |
| GlobalFoundries | GFS | Foundry silicon-photonics technology for data-center connectivity. | [Source](https://gf.com/technologies/silicon-photonics/) |
| Astera Labs | ALAB | PCIe connectivity and switching for AI servers and clusters. | [Source](https://www.asteralabs.com/solutions/ai-servers-and-clustering/) |
| Credo | CRDO | Active electrical cables and high-speed connectivity for AI clusters. | [Source](https://credosemi.com/) |
| Coherent | COHR | Optical components and connectivity for AI networks. | [Source](https://www.coherent.com/datacenter-communications) |
| Corning | GLW | Optical fiber and connectivity for AI infrastructure. | [Source](https://www.corning.com/optical-communications/emea/en/home/news-and-events/news-releases/2026/05/nvidia-and-corning-announce-long-term-partnership.html) |
| Sandisk | SNDK | Flash storage for AI data infrastructure. | [Source](https://www.sandisk.com/company/newsroom/blogs/2026/powering-ai-factories-from-the-data-layer-up) |
| Western Digital | WDC | Hard drives and storage platforms for data centers. | [Source](https://www.westerndigital.com/solutions/data-center) |
| Everpure | P | Enterprise storage and data management; formerly Pure Storage. | [Source](https://www.purestorage.com/content/dam/pdf/en/case-studies/cs-ai-ready-infrastructure.pdf) |
| NetApp | NTAP | Storage and data management integrated with NVIDIA AI infrastructure. | [Source](https://www.netapp.com/nvidia/) |
| Celestica | CLS | Data-center switches, storage and infrastructure platforms. | [Source](https://www.celestica.com/uploadedFiles/artifact/AI_Infra_Brochure.pdf) |
| Jabil | JBL | Manufacturing and integration for cloud and AI data-center hardware. | [Source](https://jabil.com/industries/data-center.html) |
| Flex | FLEX | Integrated power, cooling and compute infrastructure. | [Source](https://flex.com/resources/flex-ai-infrastructure-platform) |
| Eaton | ETN | Power distribution and management from grid to rack. | [Source](https://www.eaton.com/us/en-us/company/news-insights/news-releases/2025/eaton-accelerates-data-center-infrastrructure-in-ai-era-with-nvidia.html) |
| Modine | MOD | Cooling equipment for high-density data centers. | [Source](https://www.modine.com/news/modine-invests-in-liquid-immersion-cooling-technology-to-support-high-density-data-center-applications/) |
| Trane Technologies | TT | Data-center cooling and energy management. | [Source](https://www.tranetechnologies.com/en/index/company/data-centers.html) |
| Equinix | EQIX | Colocation and interconnection facilities supporting AI deployments. | [Source](https://www.equinix.com/data-centers) |
| Digital Realty | DLR | Data-center facilities supporting AI-ready workloads. | [Source](https://www.digitalrealty.com/data-centers) |
| Constellation Energy | CEG | Electricity supply agreements supporting data centers. | [Source](https://www.constellationenergy.com/news/2023/Constellation-signs-hourly-carbon-free-energy-matching-agreement-with-Microsoft-to-support-a-clean-powered-data-center.html) |
| Vistra | VST | Nuclear electricity agreements supporting Meta's infrastructure. | [Source](https://vistracorp.com/vistra-and-meta-a-smart-scalable-nuclear-partnership/) |
| GE Vernova | GEV | Grid and electrical infrastructure for data-center power. | [Source](https://www.gevernova.com/electrification/industries/data-centers) |
| Qualcomm | QCOM | AI inference accelerators for data-center workloads. | [Source](https://www.qualcomm.com/data-center/expertise/ai-accelerators) |
| NXP | NXPI | Neural processing units and software for edge AI. | [Source](https://www.nxp.com/products/processors-and-microcontrollers/discrete-neural-processing-units%3ADNPU) |
| Entegris | ENTG | High-purity materials and contamination control for semiconductor production. | [Source](https://www.entegris.com/en/home/our-science/by-industry/microelectronics/semiconductor.html) |
| Linde | LIN | Electronic gases used in chip manufacturing. | [Source](https://assets.linde.com/-/media/celum-connect/2023/12/21/15/11/linde20electronics20brochure185963.pdf) |
| Salesforce | CRM | Agentforce enterprise AI agents. | [Source](https://www.salesforce.com/agentforce/?bc=OTH&nc=7013y0000020IUKAA2) |
| ServiceNow | NOW | AI-enabled enterprise workflow platform. | [Source](https://www.servicenow.com/platform.html) |
| Palantir | PLTR | AIP connects enterprise data and operations with AI models. | [Source](https://www.palantir.com/docs/foundry/aip) |
| Snowflake | SNOW | Cortex AI functions for analytics over enterprise data. | [Source](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql) |
| Datadog | DDOG | Observability for LLM applications and AI agents. | [Source](https://www.datadoghq.com/knowledge-center/llm-observability/) |
| Alibaba | BABA | Alibaba Cloud infrastructure and Qwen model services. | [Source](https://www.alibabacloud.com/en/press-room/alibaba-cloud-unveil-advanced-agentic-ai-ecosystem) |
| Baidu | BIDU | AI cloud infrastructure and Kunlunxin computing technology. | [Source](https://ir.baidu.com/static-files/1e05da69-6988-4365-aee0-e45f23d71b48) |
| GDS Holdings | GDS | Data-center facilities serving hyperscale and enterprise workloads. | [Source](https://investors.gds-services.com/static-files/2e100f68-03ab-4e28-a16e-be80cadbf912) |
| VNET Group | VNET | Carrier-neutral data-center services in China. | [Source](https://ir.vnet.com/news-releases/news-release-details/vnet-reports-unaudited-fourth-quarter-and-full-year-2025) |
| NVIDIA | NVDA | AI GPUs, accelerated computing platforms and networking. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| AMD | AMD | Instinct AI accelerators and EPYC server processors. | [Source](https://www.amd.com/en/solutions/ai/trust-your-instinct.html) |
| Intel | INTC | Xeon host processors for accelerated server systems. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| TSMC | TSM | Foundry manufacturing and advanced integration for AI chips. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| Synopsys | SNPS | EDA tools and design technology for semiconductor development. | [Source](https://www.synopsys.com/resources/ai-powered-eda-chip-design-solutions.html) |
| Applied Materials | AMAT | Materials engineering and semiconductor manufacturing equipment. | [Source](https://www.appliedmaterials.com/us/en/semiconductor/products.html) |
| Micron | MU | HBM, server DRAM and data-center SSDs. | [Source](https://www.micron.com/markets-industries/ai/ai-data-center) |
| Seagate | STX | High-capacity storage supporting AI data workflows. | [Source](https://www.seagate.com/innovation/ai/storage-and-compute-infrastructure/) |
| Broadcom | AVGO | Ethernet switching silicon and adapters for AI networks. | [Source](https://www.arista.com/assets/data/pdf/Datasheets/Arista-Broadcom-AI-Networking-Solution-Brief.pdf) |
| Arista Networks | ANET | Ethernet switches and network management for AI clusters. | [Source](https://www.arista.com/assets/data/pdf/Datasheets/Arista-Broadcom-AI-Networking-Solution-Brief.pdf) |
| Marvell | MRVL | Custom silicon and connectivity for AI infrastructure. | [Source](https://nvidianews.nvidia.com/news/nvidia-ai-ecosystem-expands-as-marvell-joins-forces-through-nvlink-fusion) |
| Lumentum | LITE | Optical and laser technology for data-center interconnects. | [Source](https://nvidianews.nvidia.com/news/nvidia-announces-strategic-partnership-with-lumentum-to-develop-state-of-the-art-optics-technology) |
| Amphenol | APH | Electrical interconnect components for accelerated computing. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| Dover | DOV | CPC subsidiary provides liquid-cooling connectors. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| Dell Technologies | DELL | Server systems integrating NVIDIA accelerated computing. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| Hewlett Packard Enterprise | HPE | Servers and systems for accelerated computing. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| Supermicro | SMCI | Rack-scale AI servers and liquid-cooled systems. | [Source](https://nvidianews.nvidia.com/news/computer-industry-ai-factories-data-centers) |
| Cisco | CSCO | Networking and integrated AI infrastructure with NVIDIA. | [Source](https://newsroom.cisco.com/c/r/newsroom/en/us/a/y2026/m08/cisco-secure-ai-factory-nvidia-rack-scale.html) |
| Vertiv | VRT | Data-center power and thermal infrastructure. | [Source](https://www.vertiv.com/en-us/solutions/artificial-intelligence/) |
| Microsoft | MSFT | Azure cloud computing and AI infrastructure. | [Source](https://nvidianews.nvidia.com/news/rubin-platform-ai-supercomputer) |
| Amazon | AMZN | AWS cloud computing and AI infrastructure. | [Source](https://nvidianews.nvidia.com/news/rubin-platform-ai-supercomputer) |
| Alphabet | GOOGL | Google Cloud computing and AI infrastructure. | [Source](https://nvidianews.nvidia.com/news/rubin-platform-ai-supercomputer) |
| Meta | META | AI model and application infrastructure; a demand-side participant. | [Source](https://nvidianews.nvidia.com/news/rubin-platform-ai-supercomputer) |
| Oracle | ORCL | Oracle Cloud Infrastructure for AI workloads. | [Source](https://nvidianews.nvidia.com/news/rubin-platform-ai-supercomputer) |
| CoreWeave | CRWV | Specialized GPU cloud infrastructure. | [Source](https://nvidianews.nvidia.com/news/rubin-platform-ai-supercomputer) |
| Nebius | NBIS | AI cloud infrastructure and services. | [Source](https://nvidianews.nvidia.com/news/rubin-platform-ai-supercomputer) |
| Apple | AAPL | On-device AI and Private Cloud Compute. | [Source](https://www.apple.com/apple-intelligence/) |
| TTM Technologies | TTMI | Printed circuit boards for AI servers and hyperscale infrastructure. | [Source](https://www.ttm.com/en/blog/powering-the-ai-revolution) |

## AI 产业链 · A 股公司

62 companies · 18 stages · 66 stage memberships · 3 company-to-company relationships.

| Company | Symbol | Role | Evidence |
|---|---|---|---|
| 摩尔线程 | 688795 | 全功能 GPU、智算卡及大模型训推平台。 | [Source](https://www.mthreads.com/) |
| 沐曦股份 | 688802 | 通用 GPU 芯片及人工智能训练、推理计算平台。 | [Source](https://www.metax-tech.com/) |
| 龙芯中科 | 688047 | 国产处理器及软件生态，作为通用计算配套。 | [Source](https://loongson.cn/download/index) |
| 景嘉微 | 300474 | 国产 GPU 设计；图形处理业务与 AI 训练业务应区分。 | [Source](https://www.jingjiamicro.com/) |
| 乐鑫科技 | 688018 | 面向微控制器和物联网设备的端侧 AI 框架与芯片。 | [Source](https://docs.espressif.com/projects/esp-techpedia/en/latest/esp-friends/solution-introduction/ai/ai-solution.html) |
| 豪威集团 | 603501 | 通过豪威业务提供图像传感器，属于感知端配套。 | [Source](https://www.ovt.com/image-sensors/) |
| 兆易创新 | 603986 | 用于 AI 服务器固件等场景的闪存产品。 | [Source](https://wcwebtest.gigadevice.com/about/blog/gigadevice-memory-ai-server-innovation) |
| 佰维存储 | 688525 | SSD、DRAM 模组及终端 AI 存储产品。 | [Source](https://www.biwin.com.cn/) |
| 江波龙 | 301308 | 人工智能设备与计算场景的存储产品。 | [Source](https://www.longsys.com/industry-application/artificial-intelligence/) |
| 普冉股份 | 688766 | 非易失性存储芯片，覆盖服务器等应用。 | [Source](https://www.puyasemi.com/) |
| 沪硅产业 | 688126 | 半导体硅片及 SOI 材料，属于上游通用使能环节。 | [Source](https://www.nsig.com/) |
| 中微公司 | 688012 | 用于半导体制造的等离子体刻蚀设备。 | [Source](https://www.amec-inc.com/uploads/files/20221128/16696220508592.pdf) |
| 北方华创 | 002371 | 刻蚀、沉积、热处理及清洗等半导体设备。 | [Source](https://www.naura.com/Public/Upload/file/20230724/1690182376bfaea2da5e412c13.pdf) |
| 华海清科 | 688120 | 晶圆化学机械抛光（CMP）设备。 | [Source](https://www.hwatsing.com/en/product_detail/757.html) |
| 拓荆科技 | 688072 | 半导体薄膜沉积设备。 | [Source](https://www.piotech.cn/index.php/Pro/detail?id=130) |
| 中芯国际 | 688981 | 晶圆代工服务；不据此推断特定 AI 芯片客户。 | [Source](https://www.smics.com/uploads/7-26-3%26e4%26b8%26ad%26e8%268a%26af%26e5%269b%26bd%26e9%2699%2685%26e7%26a4%26be%26e4%26bc%269a%26e8%26b4%26a3%26e4%26bb%26bb%26e6%268a%26a5%26e5%2691%268a.pdf) |
| 华虹公司 | 688347 | 特色工艺晶圆代工，属于通用使能环节。 | [Source](https://dataclouds.cninfo.com.cn/shgonggao/2024/2024-11-08/9b24b3b69ce311ef953afa163e26e5de.pdf) |
| 长电科技 | 600584 | 面向高算力、存储及连接等领域的先进封装测试。 | [Source](https://www.jcetglobal.com/uploads/%26e9%2695%26bf%26e7%2694%26b5%26e7%26a7%2691%26e6%268a%26802024%26e5%268d%268a%26e5%26b9%26b4%26e6%268a%26a5.pdf) |
| 通富微电 | 002156 | 集成电路封装测试与高性能计算封装技术。 | [Source](https://static.cninfo.com.cn/finalpage/2026-06-05/1225353054.PDF) |
| 华天科技 | 002185 | 封装测试及面向 AI、云服务器的先进封装研发。 | [Source](https://static.cninfo.com.cn/finalpage/2026-03-31/1225059982.PDF) |
| 概伦电子 | 688206 | 面向集成电路设计与制造协同优化的 EDA 工具。 | [Source](https://www.primarius-tech.com/en/aboutus/) |
| 华大九天 | 301269 | 模拟、存储及数字电路设计 EDA 工具。 | [Source](https://empyrean.com.cn/product/eda.html) |
| 芯原股份 | 688521 | AI 图像处理、神经网络处理及接口 IP。 | [Source](https://www.verisilicon.com/en/IPPortfolio/AIPixelProcessingIP) |
| 浪潮信息 | 000977 | 元脑 AI 服务器、GPU 系统及算力管理平台。 | [Source](https://www.ieisystem.com/product/) |
| 中科曙光 | 603019 | 人工智能服务器、存储和高性能计算系统。 | [Source](https://www.sugon.com/product/lists?cate_id=68&category_id=33) |
| 工业富联 | 601138 | AI 服务器及数据中心机柜的研发与制造。 | [Source](https://panel.fii-foxconn.com/static/upload/2025/04/30/202504304482.pdf) |
| 紫光股份 | 000938 | 通过新华三提供 AI 服务器及网络基础设施。 | [Source](https://www.h3c.com/cn/d_202605/2842859_30008_0.htm) |
| 华勤技术 | 603296 | 用于云计算与 AI 推理等场景的服务器产品。 | [Source](https://www.huaqin.com/product_server/1) |
| 中兴通讯 | 000063 | 智算服务器、交换机及软硬件一体化方案。 | [Source](https://www.zte.com.cn/china/solutions_latest/computing_infrastructure/AiCube.html) |
| 锐捷网络 | 301165 | 智算中心以太网交换及集群网络方案。 | [Source](https://www.ruijie.com.cn/fa/ai-datacenter-networking/) |
| 新易盛 | 300502 | 面向 AI 数据中心的高速光模块。 | [Source](https://eoptolink.com/news/13-new-products/364-eoptolink-joins-xpo-msa-and-unveils-industry-first-12-8-tbps-liquid-cooled-pluggable-optics-for-ai-data-centers) |
| 天孚通信 | 300394 | 光引擎、光器件及高速光模块配套产品。 | [Source](https://www.tfcsz.com/product_service.html) |
| 源杰科技 | 688498 | 用于数据中心互连的激光器芯片。 | [Source](https://www.yj-semitech.com/) |
| 光迅科技 | 002281 | 用于数据中心的高速光模块及光互连方案。 | [Source](https://www.accelink.com/lighting_your_dreams/CloudandEnterprise.html) |
| 沪电股份 | 002463 | AI 服务器、高性能计算及高速网络用 PCB。 | [Source](https://static.cninfo.com.cn/finalpage/2026-08-26/1225502252.PDF) |
| 胜宏科技 | 300476 | AI 算力卡和服务器用高阶 HDI、高多层 PCB。 | [Source](https://www.shpcb.com/productprocess.html) |
| 深南电路 | 002916 | 数据中心及服务器用 PCB，并布局封装基板。 | [Source](https://www.scc.com.cn/yskjcmsresource/document/20240827/1013213911656169472.PDF) |
| 鹏鼎控股 | 002938 | 面向服务器等场景的 PCB；部分 AI 产品处于认证阶段。 | [Source](https://www.avaryholding.com/upload/file/2026-03-31/6d316ca7-f41d-4b24-b813-bc91facf842e.pdf) |
| 英维克 | 002837 | 数据中心温控、液冷板及液冷系统。 | [Source](https://www.envicool.com/product.html) |
| 高澜股份 | 300499 | 数据中心液冷及热管理方案。 | [Source](https://static.cninfo.com.cn/finalpage/2024-05-13/1220043365.PDF) |
| 申菱环境 | 301018 | 数据中心风冷、液冷及环境控制方案。 | [Source](https://www.shenling.com/applications/data-services/idc/) |
| 科华数据 | 002335 | 数据中心 UPS 与供电保障设备。 | [Source](https://www.kehua.com.cn/products/product_list?level1=%E9%AB%98%E7%AB%AF%E7%94%B5%E6%BA%90&level2=UPS) |
| 科士达 | 002518 | 数据中心 UPS、配电及热管理产品。 | [Source](https://kstar.com.cn/index.php/product/index/160.html?c=1) |
| 润泽科技 | 300442 | 数据中心、智算基础设施及算力服务。 | [Source](https://static.cninfo.com.cn/finalpage/2025-04-24/1223249829.PDF) |
| 数据港 | 603881 | 定制化数据中心规划、集成与运营。 | [Source](https://static.cninfo.com.cn/finalpage/2026-04-18/1225123486.PDF) |
| 光环新网 | 300383 | 数据中心及训练、推理算力服务。 | [Source](https://www.sinnet.com.cn/ic_service.html) |
| 用友网络 | 600588 | 企业业务场景的 AI 平台与应用。 | [Source](https://www.yonyou.com/) |
| 金山办公 | 688111 | WPS AI 办公助手与文档、演示、表格应用。 | [Source](https://ai.wps.cn/) |
| 科大讯飞 | 002230 | 星火大模型及认知智能应用。 | [Source](https://cogskl.iflytek.com/%E4%BB%A3%E8%A1%A8%E6%80%A7%E6%88%90%E6%9E%9C) |
| 中国移动 | 600941 | 移动云、算力网络与智算服务。 | [Source](https://www.chinamobileltd.com/sc/ir/reports/sd2023_ashare.pdf) |
| 中国电信 | 601728 | 天翼云与智能云基础设施。 | [Source](https://www.chinatelecom-h.com/tc/ir/presentations/annpre260324.pdf) |
| 中国联通 | 600050 | 算力调度平台、云及智能体服务。 | [Source](https://static.cninfo.com.cn/finalpage/2026-08-19/1225480022.PDF) |
| 传音控股 | 688036 | 智能终端与端侧 AI 技术开发。 | [Source](https://transsion.com/zh-CN/news?currentPage=2) |
| 汇顶科技 | 603160 | 智能终端触控与相关芯片，属于端侧配套。 | [Source](https://www.goodix.com/zh/product/touch/active_stylus_driver_chip) |
| 生益科技 | 600183 | 覆铜板及粘结片等电路板基础材料。 | [Source](https://static.cninfo.com.cn/finalpage/2026-04-25/1225195409.PDF) |
| 顺络电子 | 002138 | AI 服务器电源管理用电感等元器件。 | [Source](https://static.cninfo.com.cn/finalpage/2024-10-29/1221561573.PDF) |
| 江丰电子 | 300666 | 半导体晶圆制造及封装用高纯溅射靶材。 | [Source](https://static.cninfo.com.cn/finalpage/2026-04-28/1225228777.PDF) |
| 南大光电 | 300346 | 半导体前驱体、电子特气与光刻胶材料。 | [Source](https://static.cninfo.com.cn/finalpage/2026-04-10/1225087469.PDF) |
| 海光信息 | 688041 | 面向数据中心的国产处理器。 | [Source](https://www.hygon.cn/product/cpu) |
| 寒武纪 | 688256 | 面向人工智能训练与推理的芯片及加速卡。 | [Source](https://cambricon.com/index.php?a=lists&c=index&catid=360&m=content) |
| 澜起科技 | 688008 | 内存接口、PCIe Retimer 及 CXL 内存扩展芯片。 | [Source](https://www.montage-tech.com/Solution/AI_Server) |
| 中际旭创 | 300308 | 通过旭创科技提供 AI 与数据中心高速光模块。 | [Source](https://www.innolight.com/en/goods/solution/cid/) |

## Filing research consolidation

Filing observations are stored in `company_relationships` under `filing:` document IDs. Their original direction, company/category names, extraction details, and filing evidence are retained. Unresolved observations have `NEEDS_REVIEW` status and are excluded from the public 3D graph. Reviewed published and withdrawn records survive extraction retries.

Research run history and request state live in `company_research_runs` and `company_research_requests`. The filing API, directory, sitemap, queue, and extraction service use these stores. The filing consolidation is complete and its migration script has been removed. Deployment no longer copies or deletes legacy filing collections. Historical code remains in Git at commit `df65762`; any recovery must preserve subsequent production updates.
