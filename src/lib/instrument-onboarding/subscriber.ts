import {createServer,type IncomingHttpHeaders} from 'node:http';
import {validInstrumentId} from '../instruments/model';
import {ONBOARDING_COLLECTION} from './model';
import {createMaintenanceLog,maintenanceError} from '../maintenance-log';

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

export function createOnboardingSubscriber(options:{project:string;process:(id:string)=>Promise<{status:string}>}){
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
    }
  });
}
