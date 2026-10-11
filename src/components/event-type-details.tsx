"use client";
import type {IntelligenceEvent} from '@/lib/intelligence/model';
import {eventPresentation} from '@/lib/events/classification';
export function EventTypeDetails({event,chinese,onClose}:{event:IntelligenceEvent;chinese:boolean;onClose:()=>void}){
 const style=eventPresentation(event,chinese);
 return <div><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><strong style={{color:style.color}}>{style.symbol} {style.label}</strong><button type="button" aria-label={chinese?'关闭事件详情':'Close event details'} onClick={onClose}>×</button></div>
 {event.amendment&&<p>{chinese?'交易详情已按修订申报更新；所有原始申报链接保留在下方。':'Transaction details reflect the amended filing; all original filing links remain below.'}</p>}
 {Boolean(event.insiderTransactions?.length)&&<details open><summary>{chinese?'交易详情':'Transaction details'}</summary><ul>{event.insiderTransactions!.map((transaction,index)=><li key={index}>{transaction.ownerName} · {transaction.date}<br/>{transaction.shares} {chinese?'股':'shares'} · {transaction.security}{transaction.price&&` · $${transaction.price}`} · {transaction.code}</li>)}</ul></details>}
 </div>;
}
