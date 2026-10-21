"use client";

import {useLayoutEffect,useRef,useState} from 'react';
import type {TimelinePrice} from '@/lib/ui/company-timeline';
import {MA_COLORS,movingAverageConvergence,volumeMovingAverage} from '@/lib/ui/technical-indicators';
import {useLocale} from './providers/locale-provider';
import styles from './chart-indicator-study.module.css';

export function ChartIndicatorStudy({companyLabel,kind,prices,history,volumeAverages,onVolumeAveragesChange,onClose}:{companyLabel:string;kind:'volume'|'macd';prices:TimelinePrice[];history:TimelinePrice[];volumeAverages:boolean;onVolumeAveragesChange:(value:boolean)=>void;onClose:()=>void}){
 const {text,locale}=useLocale();
 const dialog=useRef<HTMLDialogElement>(null);
 const plot=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(1000);
 const [active,setActive]=useState<number|null>(null);
 const [showPrice,setShowPrice]=useState(true);
 const title=kind==='volume'?text('Volume study','成交量研究'):text('MACD study','MACD 研究');
 useLayoutEffect(()=>{
  const element=dialog.current;if(!element)return;
  const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
  element.showModal();
  const measure=()=>{if(plot.current?.clientWidth)setWidth(plot.current.clientWidth);};
  measure();const observer=new ResizeObserver(measure);if(plot.current)observer.observe(plot.current);
  return ()=>{observer.disconnect();element.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};
 },[]);
 const left=width<500?52:72,right=width-16,top=showPrice?205:30,bottom=480;
 const x=(index:number)=>left+(index+.5)/Math.max(1,prices.length)*(right-left);
 const indices=new Map(prices.map((price,index)=>[price.date,index]));
 const macd=movingAverageConvergence(history).filter(point=>indices.has(point.date));
 const averages=[5,10].map(period=>volumeMovingAverage(history,period).filter(point=>indices.has(point.date)));
 const maximum=Math.max(1,...prices.map(price=>price.volume??0),...(volumeAverages?averages.flatMap(points=>points.map(point=>point.value)):[]));
 const extent=Math.max(.001,...macd.flatMap(point=>[Math.abs(point.dif),Math.abs(point.signal),Math.abs(point.histogram)]))*1.1;
 const y=(value:number)=>kind==='volume'?bottom-value/maximum*(bottom-top):top+(bottom-top)/2-value/extent*(bottom-top)/2;
 const low=Math.min(...prices.map(price=>price.low??price.close)),high=Math.max(...prices.map(price=>price.high??price.close));
 const priceY=(value:number)=>160-(value-low)/Math.max(.001,high-low)*120;
 const color=(price:TimelinePrice)=>price.open===undefined?'var(--price-flat,#b8cfe1)':price.close>price.open?'var(--price-up,#55dfbb)':price.close<price.open?'var(--price-down,#ff8ea1)':'var(--price-flat,#b8cfe1)';
 const path=(points:{date:string;value:number}[])=>points.map((point,index)=>`${index===0||(indices.get(point.date)??0)!==(indices.get(points[index-1].date)??0)+1?'M':'L'}${x(indices.get(point.date)!)},${y(point.value)}`).join(' ');
 const current=active===null?null:prices[active];
 const point=current?macd.find(point=>point.date===current.date):null;
 const number=(value:number|null|undefined)=>value==null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 const barWidth=Math.max(1,Math.min(14,(right-left)/Math.max(1,prices.length)*.7));
 return <dialog ref={dialog} className={styles.dialog} aria-label={title} data-indicator-study={kind} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}} onKeyDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
  <header><div><h2>{title} · {companyLabel}</h2><small>{prices[0]?.date} – {prices.at(-1)?.date}</small></div><button type="button" autoFocus onClick={onClose} aria-label={text('Close indicator study','关闭指标研究')}>×</button></header>
  <div className={styles.controls}><label><input type="checkbox" checked={showPrice} onChange={event=>setShowPrice(event.target.checked)}/>{text('Show price context','显示 K 线参照')}</label>{kind==='volume'&&<label><input type="checkbox" checked={volumeAverages} onChange={event=>onVolumeAveragesChange(event.target.checked)}/>{text('Volume MA5 / MA10','量能 MA5 / MA10')}</label>}{kind==='macd'&&<span style={{color:MA_COLORS[0]}}>DIF <span style={{color:MA_COLORS[1]}}> · DEA</span> · {text('Histogram = DIF − DEA','柱值 = DIF − DEA')}</span>}</div>
  <p className={styles.readout} aria-live="polite">{current?<>{current.date} · {text('Close','收盘')} {number(current.close)} · {kind==='volume'?`${text('Volume','成交量')} ${number(current.volume)}`:point?`DIF ${number(point.dif)} · DEA ${number(point.signal)} · MACD ${number(point.histogram)}`:text('Insufficient history','历史数据不足')}{kind==='volume'&&volumeAverages&&averages.map((points,index)=><span key={index} style={{color:MA_COLORS[index]}}> · MA{index===0?5:10} {number(points.find(p=>p.date===current.date)?.value)}</span>)}</>:text('Move across the chart · Arrow keys inspect each stored bar','移动鼠标查看 · 方向键逐根查看已存储K线')}</p>
  <div ref={plot}><svg viewBox={`0 ${showPrice?0:top-20} ${width} ${showPrice?515:515-top+20}`} role="img" tabIndex={0} aria-label={title} onPointerMove={event=>{const box=event.currentTarget.getBoundingClientRect();const chartX=(event.clientX-box.left)/box.width*width;setActive(prices.length?Math.max(0,Math.min(prices.length-1,Math.floor((chartX-left)/(right-left)*prices.length))):null);}} onPointerLeave={()=>setActive(null)} onKeyDown={event=>{
   if(!prices.length||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();setActive(index=>event.key==='Home'?0:event.key==='End'?prices.length-1:Math.max(0,Math.min(prices.length-1,(index??0)+(event.key==='ArrowRight'?1:-1))));
  }}>
   {showPrice&&<g data-study-price><text x={left} y={20}>{text('Price · same trading sessions','股价 · 相同交易周期')}</text>{prices.map((price,index)=>price.open!==undefined&&price.high!==undefined&&price.low!==undefined?<g key={price.date}><line x1={x(index)} x2={x(index)} y1={priceY(price.high)} y2={priceY(price.low)} stroke={color(price)}/><rect x={x(index)-barWidth/2} y={Math.min(priceY(price.open),priceY(price.close))} width={barWidth} height={Math.max(1,Math.abs(priceY(price.open)-priceY(price.close)))} fill={color(price)}/></g>:null)}<path d={prices.map((price,index)=>`${index?'L':'M'}${x(index)},${priceY(price.close)}`).join(' ')} fill="none" stroke="var(--chart-line,#79cfe9)" opacity={.5}/></g>}
   {[0,.5,1].map(ratio=>{const value=kind==='volume'?maximum*ratio:extent*(ratio*2-1);return <g key={ratio}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--ui-line,#30485a)"/><text x={left-8} y={y(value)+4} textAnchor="end">{kind==='volume'?new Intl.NumberFormat(locale,{notation:'compact',maximumFractionDigits:1}).format(value):number(value)}</text></g>;})}
   {kind==='volume'?<g data-study-volume>{prices.map((price,index)=>price.volume===null?null:<rect key={price.date} x={x(index)-barWidth/2} y={y(price.volume)} width={barWidth} height={bottom-y(price.volume)} fill={color(price)}/>)}{volumeAverages&&averages.map((points,index)=><path key={index} data-volume-ma={index===0?5:10} d={path(points)} fill="none" stroke={MA_COLORS[index]} strokeWidth={2}/>)}</g>:<g data-study-macd>{macd.map(point=><rect key={point.date} x={x(indices.get(point.date)!)-barWidth/2} y={Math.min(y(0),y(point.histogram))} width={barWidth} height={Math.max(.5,Math.abs(y(point.histogram)-y(0)))} fill={point.histogram>=0?'var(--price-up,#55dfbb)':'var(--price-down,#ff8ea1)'}/>)}<path d={path(macd.map(point=>({date:point.date,value:point.dif})))} stroke={MA_COLORS[0]} fill="none" strokeWidth={2}/><path d={path(macd.map(point=>({date:point.date,value:point.signal})))} stroke={MA_COLORS[1]} fill="none" strokeWidth={2}/></g>}
   {kind==='macd'&&!macd.length&&<text x={left+15} y={top+30}>{text('Insufficient history for MACD (12, 26, 9)','MACD（12、26、9）历史数据不足')}</text>}
   {kind==='volume'&&(!prices.length||prices.every(price=>price.volume===null))&&<text x={left+15} y={top+30}>{text('Volume not recorded','未记录成交量')}</text>}
   {prices.length>0&&[...new Set([0,Math.floor((prices.length-1)/2),prices.length-1])].map(index=><text key={index} x={x(index)} y={505} textAnchor={index===0?"start":index===prices.length-1?"end":"middle"}>{prices[index].date}</text>)}
   {current&&<line data-study-crosshair x1={x(active!)} x2={x(active!)} y1={showPrice?28:top} y2={bottom} stroke="var(--ui-muted,#9db4c8)" strokeDasharray="3 3" pointerEvents="none"/>}
  </svg></div>
  <small>{text('Uses the chart’s current range and interval. Missing values are not filled.','沿用当前图表的区间和K线周期，缺失值不填补。')}</small>
 </dialog>;
}
