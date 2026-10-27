// Confirmed Shenzhen delistings. These historical identifiers should not be
// sent to the active A-share fundamentals endpoints. Reassess if re-enrolled.
// 000004: https://disc.static.szse.cn/disc/disk03/finalpage/2026-07-14/7ac00e87-c015-4085-b165-23f2a5a1ca42.PDF
// 000638: https://static.cninfo.com.cn/finalpage/2026-06-03/1225347133.PDF
const DELISTED:Readonly<Record<string,string>>={'XSHE:000004':'2026-07-14','XSHE:000638':'2026-06-03'};
export function isKnownCnDelisting(id:string,asOf=new Date().toISOString().slice(0,10)){
  const date=DELISTED[id];return Boolean(date&&asOf>=date);
}
