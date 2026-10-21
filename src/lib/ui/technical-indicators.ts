import type { TimelinePrice } from './company-timeline';

export const MA_PERIODS = [5, 10, 20, 60] as const;
export const MA_COLORS = ['#d9a441', '#aa75db', '#3988d1', '#d77942', '#36b5ae', '#e077ad', '#90a64f', '#8b98e4', '#c1875f', '#50a6a0', '#b18f4f', '#a16fba'] as const;
export const MAX_MA_PERIOD=500;
export function movingAveragePeriods(values:number[]){return [...new Set(values.filter(value=>Number.isInteger(value)&&value>=1&&value<=MAX_MA_PERIOD))].sort((a,b)=>a-b).slice(0,8);}
export type IndicatorPoint = { date:string; value:number };

/** Missing volume resets warmup; a recorded zero is a valid trading-session value. */
export function volumeMovingAverage(prices:TimelinePrice[],period:number):IndicatorPoint[] {
  if(!Number.isInteger(period)||period<1)throw new Error('Invalid MA period');
  const window:number[]=[];let sum=0;
  return prices.flatMap(price=>{
    if(price.volume===null||!Number.isFinite(price.volume)){window.length=0;sum=0;return [];}
    window.push(price.volume);sum+=price.volume;
    if(window.length>period)sum-=window.shift()!;
    return window.length===period?[{date:price.date,value:sum/period}]:[];
  });
}

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

/** BOLL (20,2): population deviation of completed closes, with full warmup. */
export function bollingerBands(prices:TimelinePrice[],period=20,deviations=2) {
  if(!Number.isInteger(period)||period<1||!Number.isFinite(deviations)||deviations<0)throw new Error('Invalid BOLL parameters');
  return simpleMovingAverage(prices,period).map((point,index)=>{
    const window=prices.slice(index,index+period);
    const deviation=Math.sqrt(window.reduce((sum,price)=>sum+(price.close-point.value)**2,0)/period);
    return {date:point.date,middle:point.value,upper:point.value+deviations*deviation,lower:point.value-deviations*deviation};
  });
}

/** KDJ (9,3,3): RSV, recursive K/D smoothing from 50, J=3K-2D. Missing OHLC resets warmup. */
export function stochasticKdj(prices:TimelinePrice[]) {
  let k=50,d=50;
  return prices.flatMap((price,index)=>{
    const window=prices.slice(Math.max(0,index-8),index+1);
    if(window.length<9||window.some(row=>row.high===undefined||row.low===undefined)){k=50;d=50;return [];}
    const high=Math.max(...window.map(row=>row.high!)),low=Math.min(...window.map(row=>row.low!));
    const rsv=high===low?50:(price.close-low)/(high-low)*100;
    k=k*2/3+rsv/3;d=d*2/3+k/3;
    return [{date:price.date,k,d,j:3*k-2*d}];
  });
}
