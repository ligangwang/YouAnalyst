import test from "node:test";
import assert from "node:assert/strict";
import { buildComparison, comparePath, parseCompareConfig, validateCompareConfig, yearsBefore, type CompareConfig } from "../src/lib/compare";
import { comparisonFrame } from "../src/lib/compare-chart";
import { mapTimelinePrice, timelineSplits } from "../src/lib/ui/company-timeline";
import { loadStockComparison } from "../src/lib/compare-service";
import type { Firestore } from "firebase-admin/firestore";
const config: CompareConfig = { symbols: ["AAPL", "NVDA"], start: "2025-01-01", end: "2025-12-31", style: "line" };

test("share links round-trip ten stocks, fixed dates and bar style", () => {
  const value = {...config, symbols: ["AAPL","NVDA","MSFT","AMZN","GOOGL","META","TSLA","AMD","AVGO","XSHG:600519"],style:"bar" as const};
  assert.deepEqual(parseCompareConfig(new URL(comparePath(value),"https://youanalyst.com").searchParams),value);
  assert.match(validateCompareConfig({...value,symbols:[...value.symbols,"INTC"]})!, /10/);
  assert.equal(validateCompareConfig({...config, start:"2025-02-30"}), "Choose a start date before the end date.");
  assert.equal(yearsBefore("2024-02-29",1),"2023-02-28");
  assert.equal(validateCompareConfig({...config,symbols:["AAPL/../secret"]}),"Choose between 1 and 10 valid stock tickers.");
});
test("normalizes stocks on common trading days and never fabricates IPO history", () => {
  const result=buildComparison([
    {symbol:"AAPL",points:[{date:"2025-01-02",close:100},{date:"2025-01-03",close:200},{date:"2025-01-06",close:220}]},
    {symbol:"NVDA",points:[{date:"2025-01-03",close:50},{date:"2025-01-06",close:40}]}
  ],config);
  assert.deepEqual(result.dates,["2025-01-03","2025-01-06"]);
  assert.deepEqual(result.series[1].values,[0,-19.999999999999996]);
  assert.equal(result.series[0].values[0],0);
  assert.ok(Math.abs(result.series[0].values[1]-10)<1e-10);
  assert.throws(()=>buildComparison([{symbol:"AAPL",points:[{date:"2025-01-02",close:100}]}],config),/two shared/);
});
test("weekly and monthly sampling preserve the actual entry and final closes", () => {
  const points=["2020-01-02","2020-01-03","2020-01-06","2020-01-07","2020-02-03","2023-01-04","2025-12-31"].map((date,i)=>({date,close:100+i}));
  const history=[{symbol:"AAPL",points}];
  const weekly=buildComparison(history,{...config,start:"2020-01-02",end:"2023-01-04"});
  assert.equal(weekly.frequency,"Weekly");
  assert.deepEqual(weekly.dates,["2020-01-02","2020-01-03","2020-01-07","2020-02-03","2023-01-04"]);
  const monthly=buildComparison(history,{...config,start:"2020-01-02"});
  assert.equal(monthly.frequency,"Monthly");
  assert.deepEqual(monthly.dates,["2020-01-02","2020-01-07","2020-02-03","2023-01-04","2025-12-31"]);
  assert.ok(Math.abs(monthly.series[0].values.at(-1)!-6)<1e-10);
  const leapRange={...config,start:"2024-01-01",end:"2026-01-01"};
  assert.equal(buildComparison([{symbol:"AAPL",points:[{date:"2024-01-02",close:100},{date:"2025-12-31",close:120}]}],leapRange).frequency,"Daily");
});
test("the comparison reuses chart split logic without adjusting legacy closes twice", () => {
  const splits=timelineSplits([{ticker:"NVDA",market:"US",type:"split",status:"completed",effectiveDate:"2025-06-02",splitNumerator:10,splitDenominator:1}],"NVDA","US",config.end);
  const old=mapTimelinePrice({ticker:"NVDA",market:"US",tradingDate:"2025-05-30",rawClose:1000,close:100}, "NVDA","US",splits)!;
  const current=mapTimelinePrice({ticker:"NVDA",market:"US",tradingDate:"2025-06-02",rawClose:110,close:110}, "NVDA","US",splits)!;
  const legacy=mapTimelinePrice({ticker:"NVDA",market:"US",tradingDate:"2025-05-30",close:100}, "NVDA","US",splits)!;
  assert.equal(old.close,100);assert.equal(legacy.close,100);
  const data=buildComparison([{symbol:"NVDA",points:[old,current]}],config);
  assert.ok(Math.abs(data.series[0].values[1]-10)<1e-10);
});
test("bar ranks swap smoothly and scales include negative returns throughout replay", () => {
  const data={dates:["2025-01-02","2025-01-03","2025-01-06"],series:[{symbol:"AAPL",values:[0,20,-10]},{symbol:"NVDA",values:[0,-10,30]}],frequency:"Daily" as const,source:"YouAnalyst EOD"};
  const mid=comparisonFrame(data,.75,"bar",390,440),end=comparisonFrame(data,1,"bar",390,440);
  assert.equal(mid.labels[0].y,mid.labels[1].y);
  assert.ok(end.labels[1].y<end.labels[0].y);
  assert.ok(mid.scale(0)>mid.left&&mid.scale(0)<mid.right);
  assert.equal(mid.low,end.low);assert.equal(mid.high,end.high);
  const line=comparisonFrame(data,1,"line",390,420);
  assert.ok(line.labels.every(label=>label.y>=line.top&&label.y<=line.bottom));
});
test("loads only stored prices/actions and uses the same chart mapper", async () => {
  const collections:string[]=[];
  const split={ticker:"NVDA",market:"US",type:"split",status:"completed",effectiveDate:"2025-06-02",splitNumerator:10,splitDenominator:1};
  const rows=[
    {ticker:"NVDA",market:"US",tradingDate:"2025-05-30",rawClose:1000,close:100},
    {ticker:"NVDA",market:"US",tradingDate:"2025-06-02",rawClose:110,close:110}
  ];
  const db={collection(name:string){
    collections.push(name);
    const query={where(){return query;},orderBy(){return query;},limit(){return query;},doc(){return {get:async()=>({data:()=>({enabled:false})})};},
      get:async()=>({docs:(name==="corporate_actions"?[split]:rows).map(row=>({data:()=>row}))})};
    return query;
  }} as unknown as Firestore;
  const data=await loadStockComparison(db,{...config,symbols:["NVDA"]});
  assert.ok(Math.abs(data.series[0].values[1]-10)<1e-10);
  assert.deepEqual([...new Set(collections)].sort(),["collectors","corporate_actions","eod_prices"]);
});
