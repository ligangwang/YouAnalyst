import {randomUUID,createHash} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {getDecodedUserFromRequest} from '@/lib/firebase/auth';
import {isAdminUser} from '@/lib/firebase/admin-role';
import {getAdminFirestore} from '@/lib/firebase/admin';
import {CN_COMPANY_ID} from '@/lib/knowledge-graph/cn-companies';
import {publishCnRequests} from '@/lib/fundamentals/cn-pubsub';
import {parseCnDiscoveryTask,CN_DISCOVERY_TOPIC} from '@/lib/events/cn-discovery-queue';
import {publishJobMessage} from '@/lib/job-pubsub';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function authorize(request:NextRequest){const user=await getDecodedUserFromRequest(request);return user&&await isAdminUser(user)?user:null;}
const refFor=(db:ReturnType<typeof getAdminFirestore>,kind:string,id:string)=>kind==='fundamentals'?db.collection('company_fundamentals').doc(id):kind==='announcements'?db.collection('collectors').doc(`exchange-${id}`):db.collection('earnings_collectors').doc(`cn_${id}`);
export async function GET(request:NextRequest){
  if(!await authorize(request))return reply({error:'Forbidden'},403);
  const db=getAdminFirestore();
  try{
    const [fundamentals,announcements,earnings]=await Promise.all(['company_fundamentals','collectors','earnings_collectors'].map(name=>db.collection(name).where('manualRequired','==',true).limit(100).get()));
    const errors=[
      ...fundamentals.docs.filter(doc=>CN_COMPANY_ID.test(doc.id)).map(doc=>({id:doc.id,companyId:doc.id,kind:'fundamentals',message:doc.get('cnAnnualStatus.lastError')??doc.get('cnShareStatus.lastError.message')??doc.get('cnActionStatus.lastError.message')??'A-share financial refresh failed',failedAt:doc.get('cnAnnualStatus.attemptedAt')??doc.get('cnShareStatus.attemptedAt')??null})),
      ...announcements.docs.filter(doc=>doc.id.startsWith('exchange-')&&CN_COMPANY_ID.test(doc.id.slice(9))).map(doc=>({id:doc.id.slice(9),companyId:doc.id.slice(9),kind:'announcements',message:doc.get('lastError')??'China discovery failed',failedAt:doc.get('lastAttemptAt')??null})),
      ...earnings.docs.filter(doc=>doc.id.startsWith('cn_')&&CN_COMPANY_ID.test(doc.id.slice(3))).map(doc=>({id:doc.id.slice(3),companyId:doc.id.slice(3),kind:'earnings-fallback',message:doc.get('lastError')??'China earnings discovery failed',failedAt:doc.get('lastAttemptAt')??null})),
    ];
    return reply({errors,limitPerKind:100});
  }catch{return reply({error:'Unable to load China failures.'},503);}
}
export async function POST(request:NextRequest){
  if(!await authorize(request))return reply({error:'Forbidden'},403);
  let body:unknown;try{body=await request.json();}catch{return reply({error:'Invalid request'},400);}
  const {id,kind}=body as {id?:unknown;kind?:unknown}??{};
  if(typeof id!=='string'||!CN_COMPANY_ID.test(id)||typeof kind!=='string'||!['fundamentals','announcements','earnings-fallback'].includes(kind))return reply({error:'Invalid China task'},400);
  const db=getAdminFirestore(),ref=refFor(db,kind,id);
  try{
    if((await ref.get()).get('manualRequired')!==true)return reply({error:'This task is no longer awaiting review.'},409);
    if(kind==='fundamentals')await publishCnRequests(db,randomUUID(),[id],task=>publishJobMessage('cn-fundamentals-requests',task),{manual:true});
    else{
      const requestedAt=new Date().toISOString(),batchId='cn_manual_'+createHash('sha256').update(randomUUID()).digest('hex');
      const task=parseCnDiscoveryTask({version:1,type:'cn.company.discovery.requested',batchId,companyId:id,mode:kind,requestedAt});
      await publishJobMessage(CN_DISCOVERY_TOPIC,task);
    }
    return reply({ok:true},202);
  }catch{return reply({error:'Could not queue rerun. The failure remains available to retry.'},503);}
}
