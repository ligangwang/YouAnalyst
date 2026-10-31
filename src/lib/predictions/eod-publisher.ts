import {setTimeout as delay} from 'node:timers/promises';
import {publishJobMessage} from '../job-pubsub';
import type {EodMessage} from './eod-company-queue';

/** A parent occupies one of four workers. Pace children instead of bursting 25
 * HTTP deliveries into the remaining slots and exhausting their retry budget. */
export function pacedEodPublisher(
  publish:(message:EodMessage)=>Promise<unknown>,
  pause:(ms:number)=>Promise<unknown>=delay,
){
  return async(message:EodMessage)=>{
    const result=await publish(message);
    if(message.type==='company.work.requested')await pause(1000);
    return result;
  };
}
export const publishEodMessage=pacedEodPublisher(message=>publishJobMessage(process.env.EOD_REQUEST_TOPIC||'eod-maintenance-requests',message));
