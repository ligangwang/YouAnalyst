import {NextRequest,NextResponse} from 'next/server';
import {getAdminFirestore} from '@/lib/firebase/admin';
import {requestCompanyOnboarding} from '@/lib/company-onboarding/queue';
import {OnboardingBlocked} from '@/lib/company-onboarding/model';

/** Record interest only. This route never dispatches or runs paid provider work. */
export async function POST(request:NextRequest){
  try{
    const origin=request.headers.get('origin');
    if(origin&&origin!==request.nextUrl.origin)return NextResponse.json({error:'Invalid request origin'},{status:403});
    if(Number(request.headers.get('content-length'))>4096)return NextResponse.json({error:'Request too large'},{status:413});
    const body=await request.text();if(body.length>4096)return NextResponse.json({error:'Request too large'},{status:413});
    let value:unknown;try{value=JSON.parse(body);}catch{return NextResponse.json({error:'Invalid request'},{status:400});}
    const id=(value as {companyId?:unknown}|null)?.companyId;
    if(typeof id!=='string')return NextResponse.json({error:'companyId is required'},{status:400});
    return NextResponse.json({ok:true,...await requestCompanyOnboarding(getAdminFirestore(),id)});
  }catch(error){
    if(error instanceof OnboardingBlocked)return NextResponse.json({error:error.message},{status:400});
    return NextResponse.json({error:'Unable to record onboarding request'},{status:503});
  }
}
