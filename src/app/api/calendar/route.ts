import { loadCalendar, calendarRange } from '@/lib/calendar/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const url = new URL(request.url);
  let range;
  try { range = calendarRange(url.searchParams.get('from'),url.searchParams.get('to')); }
  catch(error) {return Response.json({error:error instanceof Error?error.message:'Invalid date range'},{status:400});}
  try { return Response.json(await loadCalendar(range.from,range.to),{headers:{'Cache-Control':'public, max-age=30, s-maxage=60'}}); }
  catch { return Response.json({error:'Calendar is temporarily unavailable.'},{status:503}); }
}
