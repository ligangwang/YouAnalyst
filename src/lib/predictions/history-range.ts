import {marketDate,type PredictionMarket} from './instrument';

export function historyThrough(market:PredictionMarket,now=new Date()){
  const today=marketDate(market,now);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:market==='US'?'America/New_York':'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(now));
  return hour>=18?today:new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
}
