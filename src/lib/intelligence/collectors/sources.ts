import mapIrFeeds from './map-ir-feeds.json';
export type NewsSource = {
  id:string; companyId:string; name:string; url:string; allowedHosts:string[]; articleHostAliases?:Record<string,string>; publicationFromArticle?:boolean; articleDateFormat?:'apple-newsroom'; pollMs:number;
  format?:'html'; articlePathPattern?:string; transport?:'https'; articleDateOnly?:boolean; upgradeArticleHttp?:boolean;
  indexDateFormat?:'alibaba'|'vistra'; articleVisibleDate?:'linde'; reviewRequired?:string;
  excludedCategories?:string[];
};

/** Publisher-owned feeds, verified individually. No user-supplied fetch targets. */
// Samsung Global Newsroom returns HTTP 403 from Cloud Run; exclude until verified there.
export const NEWS_SOURCES:readonly NewsSource[] = [
  {id:'nvidia-news',companyId:'US:NVDA',name:'NVIDIA Newsroom',url:'https://nvidianews.nvidia.com/cats/press_release.xml',allowedHosts:['nvidianews.nvidia.com'],pollMs:60*60_000},
  {id:'amd-news',companyId:'US:AMD',name:'AMD Newsroom',url:'https://newsroom.amd.com/rss.xml',allowedHosts:['newsroom.amd.com','www.amd.com','ir.amd.com'],pollMs:60*60_000},
  {id:'microsoft-news',companyId:'US:MSFT',name:'Microsoft Corporate Blog',url:'https://blogs.microsoft.com/feed/',allowedHosts:['blogs.microsoft.com'],pollMs:60*60_000},
  {id:'coreweave-news',companyId:'US:CRWV',name:'CoreWeave Blog',url:'https://www.coreweave.com/blog/rss.xml',allowedHosts:['www.coreweave.com','coreweave.com'],articleHostAliases:{'wf.coreweave.com':'www.coreweave.com'},publicationFromArticle:true,pollMs:60*60_000},
  {id:'broadcom-news',companyId:'US:AVGO',name:'Broadcom Investor News',url:'https://investors.broadcom.com/rss/news-releases.xml',allowedHosts:['investors.broadcom.com'],pollMs:60*60_000},
  {id:'marvell-news',companyId:'US:MRVL',name:'Marvell Investor News',url:'https://investor.marvell.com/news-events/press-releases/rss',allowedHosts:['investor.marvell.com'],pollMs:60*60_000},
  {id:'kla-news',companyId:'US:KLAC',name:'KLA Investor News',url:'https://ir.kla.com/news-events/press-releases/rss',allowedHosts:['ir.kla.com'],pollMs:60*60_000},
  {id:'applied-materials-news',companyId:'US:AMAT',name:'Applied Materials Investor News',url:'https://ir.appliedmaterials.com/rss/news-releases.xml',allowedHosts:['ir.appliedmaterials.com'],pollMs:60*60_000},
  {id:'lam-research-news',companyId:'US:LRCX',name:'Lam Research Investor News',url:'https://investor.lamresearch.com/index.php?s=43&pagetemplate=rss',allowedHosts:['investor.lamresearch.com'],pollMs:60*60_000},
  {id:'nxp-news',companyId:'US:NXPI',name:'NXP Investor News',url:'https://investors.nxp.com/rss/news-releases.xml',allowedHosts:['investors.nxp.com'],pollMs:60*60_000},
  {id:'globalfoundries-news',companyId:'US:GFS',name:'GlobalFoundries Investor News',url:'https://investors.gf.com/rss/news-releases.xml',allowedHosts:['investors.gf.com'],pollMs:60*60_000},
  {id:'datadog-news',companyId:'US:DDOG',name:'Datadog Investor News',url:'https://investors.datadoghq.com/rss/news-releases.xml',allowedHosts:['investors.datadoghq.com'],pollMs:60*60_000},
  {id:'arm-news',companyId:'US:ARM',name:'Arm Newsroom',url:'https://newsroom.arm.com/feed',allowedHosts:['newsroom.arm.com'],pollMs:60*60_000},
  {id:'google-news',companyId:'US:GOOGL',name:'Google Official Blog',url:'https://blog.google/rss/',allowedHosts:['blog.google'],pollMs:60*60_000},
  {id:'amazon-news',companyId:'US:AMZN',name:'Amazon Science',url:'https://www.amazon.science/index.rss',allowedHosts:['www.amazon.science'],pollMs:60*60_000},
  {id:'apple-news',companyId:'US:AAPL',name:'Apple Newsroom',publicationFromArticle:true,articleDateFormat:'apple-newsroom',url:'https://www.apple.com/newsroom/rss-feed.rss',allowedHosts:['www.apple.com'],pollMs:60*60_000},
  {id:'intel-news',companyId:'US:INTC',name:'Intel Investor News',url:'https://www.intc.com/news-events/press-releases/rss',allowedHosts:['www.intc.com'],pollMs:60*60_000},
  {id:'arista-news',companyId:'US:ANET',name:'Arista Press Releases',url:'https://www.arista.com/en/company/news/press-release-rss',allowedHosts:['www.arista.com'],pollMs:60*60_000},
  ...(mapIrFeeds as NewsSource[]).filter(source=>!source.reviewRequired),
];
export const IR_SOURCES_REQUIRING_REVIEW=(mapIrFeeds as NewsSource[]).filter(source=>source.reviewRequired);
