import { proxyAuthRequest } from "@/lib/firebase/auth-proxy";

export const runtime = "nodejs";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyAuthRequest(request, path, process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
}

export { handle as GET, handle as POST };
