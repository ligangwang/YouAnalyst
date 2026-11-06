import {createServer,type IncomingHttpHeaders} from 'node:http';
import {validInstrumentId} from '../instruments/model';
import {ONBOARDING_COLLECTION} from './model';
import {createMaintenanceLog,maintenanceError} from '../maintenance-log';
import {onboardingDeliveryProbeId} from './delivery-check';
import {onboardingEventDisposition} from './delivery-events';

// Cloud Run IAM authenticates Eventarc. Header validation only restricts routing.
// We read the current durable request, never trust an out-of-order event payload.
export function onboardingEventId(headers:IncomingHttpHeaders,project:string){
  if(headers['ce-type']!=='google.cloud.firestore.document.v1.written'
    ||headers['ce-source']!==`//firestore.googleapis.com/projects/${project}/databases/(default)`
    ||headers['ce-specversion']!=='1.0'||typeof headers['ce-id']!=='string')throw Error('Unexpected onboarding event');
  const subject=headers['ce-subject'],prefix=`documents/${ONBOARDING_COLLECTION}/`;
  if(typeof subject!=='string'||!subject.startsWith(prefix))throw Error('Unexpected onboarding document');
  const id=subject.slice(prefix.length);
  if(!validInstrumentId(id))throw Error('Invalid onboarding instrument');
  return id;
}

export function createOnboardingSubscriber(options:{project:string;process:(id:string,eventId?:string)=>Promise<{status:string}>;admit?:(id:string,eventId:string)=>Promise<'ready'|'missing'|'terminal'|'duplicate'|'retry'|'capacity'>;probe?:(id:string)=>Promise<boolean>;sha?:string}){
  // Cloud Run admits four HTTP requests; at most two wait on provider work.
  // Leave room for health/probes and quick duplicate acknowledgements at full load.
  // Only one provider operation runs here; the second held delivery waits locally.
  let held=0;
  let slot=Promise.resolve();
  const active=new Map<string,Promise<{status:string}>>();
  const serialize=(work:()=>Promise<{status:string}>)=>{
    const previous=slot;let release!:()=>void;slot=new Promise<void>(resolve=>{release=resolve;});
    return previous.then(async()=>{try{return await work();}finally{release();}});
  };
  return createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sha:options.sha??process.env.GIT_SHA??'unknown'}));return;}
    if(req.method!=='POST'||req.url!=='/events'){res.writeHead(404);res.end();return;}
    let id:string,body:Buffer;
    let holding=false;
    try{
      id=onboardingEventId(req.headers,options.project);
      let size=0;const chunks:Buffer[]=[];
      for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('Event too large');chunks.push(Buffer.from(chunk));}
      body=Buffer.concat(chunks);
    }catch{res.writeHead(400);res.end('Invalid event');return;}
    const sha=options.sha??process.env.GIT_SHA??'';
    if(options.probe&&/^[a-f0-9]{40}$/.test(sha)&&id===onboardingDeliveryProbeId(sha)&&req.headers['ce-id']==='delivery-check-'+sha){
      try{if(await options.probe(id)){res.writeHead(204);res.end();return;}}catch{/* Fail closed if the probe cannot confirm absence. */}
      res.writeHead(503);res.end('Probe request is not absent');return;
    }
    const log=createMaintenanceLog('instrument-onboarding-message',{instrumentId:id});
    let disposition:ReturnType<typeof onboardingEventDisposition>;
    try{disposition=onboardingEventDisposition(body,String(req.headers['content-type']??''),options.project,id);}
    catch{res.writeHead(400);res.end('Invalid event document');return;}
    if(['claim_event','terminal_event','deleted_event'].includes(disposition)){
      log.emit('INFO','message_ignored',{reason:disposition});res.writeHead(204,{'x-onboarding-disposition':disposition});res.end();return;
    }
    try{
      const eventId=req.headers['ce-id'] as string;
      const key=`${id}:${eventId}`;
      let work=active.get(key);
      if(!work){
        const admission=await options.admit?.(id,eventId)??'ready';
        // Another request may have started this same delivery during the read.
        work=active.get(key);
        if(!work){
          if(admission==='retry'||admission==='capacity'){
            log.emit('INFO','message_deferred',{reason:admission});res.writeHead(503);res.end('Delivery still requires retry');return;
          }
          if(admission!=='ready'){
            log.emit('INFO','message_ignored',{reason:admission});res.writeHead(204);res.end();return;
          }
          if(held>=2){log.emit('INFO','message_deferred',{reason:'capacity'});res.writeHead(503);res.end('Work slots full');return;}
          held++;holding=true;
          work=serialize(()=>res.destroyed?Promise.resolve({status:'CONTINUE'}):options.process(id,eventId));
          active.set(key,work);
          void work.finally(()=>{active.delete(key);}).catch(()=>{});
        }else log.emit('INFO','message_coalesced');
      }else log.emit('INFO','message_coalesced');
      if(!holding){
        if(held>=2){log.emit('INFO','message_deferred',{reason:'capacity'});res.writeHead(503);res.end('Work slots full');return;}
        held++;holding=true;
      }
      const result=await work;
      log.emit('INFO','message_completed',result);
      // Redelivery continues ready work/lease contention. A failed checkpoint is
      // persisted BLOCKED and acknowledged, including transient provider errors.
      if(!res.destroyed){res.writeHead(result.status==='CONTINUE'?503:204);res.end();}
    }catch(error){
      log.emit('ERROR','message_failed',{error:maintenanceError(error)});
      if(!res.destroyed){res.writeHead(503);res.end('Inspect durable checkpoint');}
    }finally{if(holding)held--;}
  });
}
