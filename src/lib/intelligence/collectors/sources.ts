export type NewsSource = {
  id:string; companyId:string; name:string; url:string; allowedHosts:string[]; articleHostAliases?:Record<string,string>; pollMs:number;
};

/** Publisher-owned feeds, verified individually. No user-supplied fetch targets. */
export const NEWS_SOURCES:readonly NewsSource[] = [
  {id:'nvidia-news',companyId:'US:NVDA',name:'NVIDIA Newsroom',url:'https://nvidianews.nvidia.com/cats/press_release.xml',allowedHosts:['nvidianews.nvidia.com'],pollMs:5*60_000},
  {id:'amd-news',companyId:'US:AMD',name:'AMD Newsroom',url:'https://newsroom.amd.com/rss.xml',allowedHosts:['newsroom.amd.com','www.amd.com','ir.amd.com'],pollMs:5*60_000},
  {id:'microsoft-news',companyId:'US:MSFT',name:'Microsoft Corporate Blog',url:'https://blogs.microsoft.com/feed/',allowedHosts:['blogs.microsoft.com'],pollMs:5*60_000},
  {id:'coreweave-news',companyId:'US:CRWV',name:'CoreWeave Blog',url:'https://www.coreweave.com/blog/rss.xml',allowedHosts:['www.coreweave.com','coreweave.com'],articleHostAliases:{'wf.coreweave.com':'www.coreweave.com'},pollMs:5*60_000},
];
