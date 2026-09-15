import { NextRequest } from "next/server";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";
import { isAdminUser } from "@/lib/firebase/admin-role";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { CompanyNameError, editCompanyName } from "@/lib/market-companies/edit-name";

export const runtime = "nodejs";
export async function PATCH(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const user = await getDecodedUserFromRequest(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    if (!await isAdminUser(user)) return Response.json({ error: "Forbidden" }, { status: 403, headers });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ error: "Use application/json" }, { status: 415, headers });
    const reader = request.body?.getReader();
    if (!reader) throw new CompanyNameError(400, "JSON body required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); throw new CompanyNameError(413, "Request too large"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new CompanyNameError(400, "Invalid JSON"); }
    return Response.json(await editCompanyName(getAdminFirestore(), input, user.uid), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof CompanyNameError ? error.message : "Unable to update company name" }, { status: error instanceof CompanyNameError ? error.status : 503, headers });
  }
}
