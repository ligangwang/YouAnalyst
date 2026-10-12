import type { TimelinePrice } from './company-timeline';

export const MA_PERIODS = [5, 10, 20, 60] as const;
export const MA_COLORS = ['#d9a441', '#aa75db', '#3988d1', '#d77942'] as const;
export type IndicatorPoint = { date:string; value:number };

/** Periods count stored trading sessions, never calendar days or invented holiday prices. */
export function simpleMovingAverage(prices: TimelinePrice[], period:number): IndicatorPoint[] {
  if (!Number.isInteger(period) || period < 1) throw new Error('Invalid MA period');
  let sum = 0;
  return prices.flatMap((price,index) => {
    sum += price.close;
    if (index >= period) sum -= prices[index-period].close;
    return index >= period-1 ? [{date:price.date,value:sum/period}] : [];
  });
}

function ema(values: IndicatorPoint[], period:number): IndicatorPoint[] {
  if (values.length < period) return [];
  let average = values.slice(0,period).reduce((sum,point)=>sum+point.value,0)/period;
  const result = [{date:values[period-1].date,value:average}];
  for (const point of values.slice(period)) {
    average += 2/(period+1)*(point.value-average);
    result.push({date:point.date,value:average});
  }
  return result;
}

/** MACD 12/26/9: histogram = DIF - signal (unscaled, also known as DEA). */
export function movingAverageConvergence(prices:TimelinePrice[]) {
  const input = prices.map(price=>({date:price.date,value:price.close}));
  const fast = new Map(ema(input,12).map(point=>[point.date,point.value]));
  const dif = ema(input,26).map(point=>({date:point.date,value:fast.get(point.date)!-point.value}));
  const signals = new Map(ema(dif,9).map(point=>[point.date,point.value]));
  return dif.flatMap(point=>{
    const signal = signals.get(point.date);
    return signal===undefined?[]:[{date:point.date,dif:point.value,signal,histogram:point.value-signal}];
  });
}
