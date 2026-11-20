import { NextRequest, NextResponse } from 'next/server';
import { MEMBER_COOKIE } from '@/lib/access/policy';
import { verifyMember } from '@/lib/access/member';

function sameOrigin(request: NextRequest) {
  return request.headers.get('origin') === request.nextUrl.origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, {status:403});
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const claims = await verifyMember(token);
  if (!claims) return new NextResponse(null, {status:401});
  const response = new NextResponse(null, {status:204, headers:{'Cache-Control':'private, no-store'}});
  response.cookies.set(MEMBER_COOKIE, token, {httpOnly:true, secure:request.nextUrl.protocol === 'https:', sameSite:'lax', path:'/', maxAge:Math.max(0, claims.exp - Math.floor(Date.now()/1000))});
  return response;
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, {status:403});
  const response = new NextResponse(null, {status:204, headers:{'Cache-Control':'private, no-store'}});
  response.cookies.set(MEMBER_COOKIE, '', {httpOnly:true, secure:request.nextUrl.protocol === 'https:', sameSite:'lax', path:'/', maxAge:0});
  return response;
}
