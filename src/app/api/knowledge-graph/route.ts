import {loadThemeCatalog} from '@/lib/company-themes/catalog';
import {resolveCatalogTheme} from '@/lib/company-themes/catalog-model';
import { loadThemeGraph } from '@/lib/company-themes/graph-service';
import {withCompanyPageReads} from '@/lib/local-cache/company-page-scope';
export const runtime = "nodejs";
export async function GET(request:Request) {
  try {
    const theme=resolveCatalogTheme(await loadThemeCatalog(),new URL(request.url).searchParams.get('theme'));
    if(!theme)return Response.json({error:'Unknown or unpublished theme'},{status:404,headers:{'Cache-Control':'no-store'}});
    // Company charts also call this public route. Read the published graph's
    // targeted subscriptions rather than the entire market's snapshot files.
    return Response.json(await withCompanyPageReads(()=>loadThemeGraph(theme)), { headers: { "Cache-Control": "no-store", "X-Graph-Storage": "company_relationships" } });
  } catch {
    return Response.json({ error: "Knowledge graph unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
