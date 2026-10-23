import type {Firestore} from 'firebase-admin/firestore';
import {publishJobMessage} from '../job-pubsub';
import {EARNINGS_TOPIC,parseEarningsJob,type EarningsJob} from '../earnings/live-event';
import {EARNINGS_SOURCES,type EarningsWork} from '../earnings/live-store';
import {SEC_DOWNLOAD_TOPIC} from './download-worker';

/** Every earnings producer, including exhibit fan-out and outbox replay, uses
 * this same boundary. Financial/relationship events retain their own queues. */
export async function publishEarningsIntake(db:Firestore,input:EarningsJob,options:{
  enabled?:boolean;publish?:typeof publishJobMessage;readWork?:(id:string)=>Promise<EarningsWork|undefined>;
}={}){
  const event=parseEarningsJob(input),publish=options.publish??publishJobMessage;
  if(!(options.enabled??process.env.SEC_INCREMENTAL_DOWNLOADS_ENABLED==='1')||event.type==='earnings.delivery.probe')return publish(EARNINGS_TOPIC,event);
  const work=await (options.readWork??(id=>db.collection(EARNINGS_SOURCES).doc(id).get().then(doc=>doc.data() as EarningsWork|undefined)))(event.sourceId);
  if(!work||work.sourceId!==event.sourceId||work.generation!==event.generation)throw new Error('Earnings intake has no matching durable source');
  if(!['sec','cninfo'].includes(work.source.provider))throw new Error('Unsupported earnings intake provider');
  return publish(work.source.provider==='sec'?SEC_DOWNLOAD_TOPIC:EARNINGS_TOPIC,event);
}
