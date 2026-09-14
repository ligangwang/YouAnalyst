export function followedCompanyIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && /^[A-Z0-9:._-]{1,100}$/.test(id)))].slice(0, 200) : [];
}
export function createMapFollowHandlers(deps: {
  authenticate: (request: Request) => Promise<string | null>;
  read: (uid: string) => Promise<unknown>;
  exists: (id: string) => Promise<boolean>;
  update: (uid: string, id: string, follow: boolean) => Promise<string[]>;
}) {
  const headers = { "Cache-Control": "private, no-store" };
  async function handle(request: Request, write: boolean) {
    try {
      const uid = await deps.authenticate(request);
      if (!uid) return Response.json({}, {status:401,headers});
      if (!write) return Response.json({companyIds:followedCompanyIds(await deps.read(uid))},{headers});
      const body = await request.json().catch(()=>null);
      if (typeof body?.companyId !== "string" || !/^[A-Z0-9:._-]{1,100}$/.test(body.companyId) || typeof body.follow !== "boolean") return Response.json({}, {status:400,headers});
      if (body.follow && !(await deps.exists(body.companyId))) return Response.json({}, {status:404,headers});
      return Response.json({companyIds:await deps.update(uid,body.companyId,body.follow)},{headers});
    } catch { return Response.json({}, {status:503,headers}); }
  }
  return { GET: (request: Request) => handle(request,false), PATCH: (request: Request) => handle(request,true) };
}
