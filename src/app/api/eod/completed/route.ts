import {getAdminFirestore} from '@/lib/firebase/admin';
import {readCompletedEodDates} from '@/lib/ui/completed-eod-dates';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  const headers={'Cache-Control':'no-store'};
  try{return Response.json(await readCompletedEodDates(getAdminFirestore()),{headers});}
  catch{return Response.json({error:'Completed EOD dates are unavailable'},{status:503,headers});}
}
