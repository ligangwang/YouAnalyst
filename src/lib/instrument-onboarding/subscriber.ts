import {createServer,type IncomingHttpHeaders} from 'node:http';
import {validInstrumentId} from '../instruments/model';
import {ONBOARDING_COLLECTION} from './model';
import {createMaintenanceLog,maintenanceError} from '../maintenance-log';
import {onboardingDeliveryProbeId} from './delivery-check';

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

export function createOnboardingSubscriber(options:{project:string;process:(id:string)=>Promise<{status:string}>;probe?:(id:string)=>Promise<boolean>;sha?:string}){
  let busy=false;
  return createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sha:process.env.GIT_SHA??'unknown'}));return;}
    if(req.method!=='POST'||req.url!=='/events'){res.writeHead(404);res.end();return;}
    let id:string;
    try{
      id=onboardingEventId(req.headers,options.project);
      let size=0;
      // Firestore sends protobuf; only authenticated CloudEvent routing is needed.
      for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('Event too large');}
    }catch{res.writeHead(400);res.end('Invalid event');return;}
    const sha=options.sha??process.env.GIT_SHA??'';
    if(options.probe&&/^[a-f0-9]{40}$/.test(sha)&&id===onboardingDeliveryProbeId(sha)&&req.headers['ce-id']==='delivery-check-'+sha){
      try{if(await options.probe(id)){res.writeHead(204);res.end();return;}}catch{/* Fail closed if the probe cannot confirm absence. */}
      res.writeHead(503);res.end('Probe request is not absent');return;
    }
    // Leave HTTP slots for health and delivery checks while one long request
    // is active. The two-instance service still processes at most two stocks.
    if(busy){res.writeHead(503);res.end('Worker busy');return;}
    busy=true;
    const log=createMaintenanceLog('instrument-onboarding-message',{instrumentId:id});
    try{
      const result=await options.process(id);
      log.emit('INFO','message_completed',result);
      // Redelivery continues ready work/lease contention. A failed checkpoint is
      // persisted BLOCKED and acknowledged, including transient provider errors.
      res.writeHead(result.status==='CONTINUE'?503:204);res.end();
    }catch(error){
      log.emit('ERROR','message_failed',{error:maintenanceError(error)});
      res.writeHead(503);res.end('Inspect durable checkpoint');
    }finally{busy=false;}
  });
}
