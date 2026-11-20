import { NextRequest, NextResponse } from 'next/server';
import { COMPANY_SLUG_INVENTORY, inventoryCompanyPath } from '@/lib/market-companies/slug-inventory';

// Names and identifiers only, from the release inventory. No live research reads.
const companies = Object.entries(COMPANY_SLUG_INVENTORY).map(([id, slug]) => ({
  id, symbol:id.split(':').at(-1)!, name:slug.replace(/-/g, ' '), path:inventoryCompanyPath(id, slug),
}));
export function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 100);
  const items = query ? companies.filter(item => item.symbol.toLowerCase().includes(query) || item.name.includes(query))
    .sort((a,b) => Number(b.symbol.toLowerCase() === query) - Number(a.symbol.toLowerCase() === query)).slice(0,8) : [];
  return NextResponse.json({items}, {headers:{'Cache-Control':'public, max-age=3600'}});
}
