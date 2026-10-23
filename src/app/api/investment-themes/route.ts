import { loadThemeCatalog } from '@/lib/company-themes/catalog';
export const dynamic='force-dynamic';
export async function GET() {
  try { return Response.json({nodes:await loadThemeCatalog()},{headers:{'Cache-Control':'public, max-age=60'}}); }
  catch { return Response.json({error:'Investment themes temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store'}}); }
}
