import { NextResponse } from "next/server";
// Preserve existing clients and POST bodies while moving saved-company calls.
function redirect(request: Request) { return NextResponse.redirect(new URL("/api/knowledge-graph/saved", request.url), 308); }
export const GET=redirect;
export const POST=redirect;
