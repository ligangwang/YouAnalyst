/** A price request represents one visible page plus the selected company. */
export const PRICE_PEER_PAGE_SIZE=12;
const validId=(id:string)=>/^(US:[A-Z0-9][A-Z0-9.-]{0,11}|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(id);
export function normalizePriceDemand(companyId:string,ids:readonly string[]):string[]|null{
 if(!validId(companyId)||ids.length>PRICE_PEER_PAGE_SIZE+1||ids.some(id=>!validId(id)))return null;
 const unique=[...new Set([companyId,...ids])];
 return unique.length<=PRICE_PEER_PAGE_SIZE+1?unique:null;
}
export function visiblePriceIds(companyId:string,ordered:readonly {id:string}[],expanded:boolean,page:number):string[]{
 const rows=expanded?ordered.filter(row=>row.id!==companyId).slice(page*PRICE_PEER_PAGE_SIZE,(page+1)*PRICE_PEER_PAGE_SIZE):ordered.slice(0,3);
 return [...new Set([companyId,...rows.map(row=>row.id)])];
}
