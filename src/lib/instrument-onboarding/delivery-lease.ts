import {createHash,randomUUID} from 'node:crypto';

const eventKey=(eventId:string)=>createHash('sha256').update(eventId).digest('hex').slice(0,32);

/** Keep invocation fencing, while identifying which durable delivery owns it. */
export function onboardingLeaseOwner(eventId?:string){
  return eventId?`event:${eventKey(eventId)}:${randomUUID()}`:randomUUID();
}

/** Only another delivery may acknowledge contention; the owner's retry must survive a crash. */
export function isDuplicateLease(owner:string|null,eventId?:string){
  const match=owner?.match(/^event:([a-f0-9]{32}):[a-f0-9-]{36}$/);
  return Boolean(eventId&&match&&match[1]!==eventKey(eventId));
}
