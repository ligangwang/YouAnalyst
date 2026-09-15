import { OAuth2Client, type TokenPayload } from "google-auth-library";
export class ResearchError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Publisher = { sub: string; email: string };
const verifier = new OAuth2Client();
export function authorizeClaims(payload: TokenPayload | undefined, expected: { audience: string; sub: string; email: string }, now = Date.now() / 1000): Publisher {
  if (!payload || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) || payload.aud !== expected.audience || !payload.exp || payload.exp <= now || !payload.iat || payload.iat > now + 30 || payload.exp - payload.iat > 3700) throw new ResearchError(401, "Invalid or expired publisher token");
  if (payload.sub !== expected.sub || payload.email !== expected.email || payload.email_verified !== true) throw new ResearchError(403, "Publishing identity not authorized");
  return { sub: payload.sub, email: payload.email };
}
export async function authenticatePublisher(request: Request): Promise<Publisher> {
  const audience = process.env.RESEARCH_TOKEN_AUDIENCE, sub = process.env.RESEARCH_PUBLISHER_SUB, email = process.env.RESEARCH_PUBLISHER_EMAIL;
  if (!audience || !sub || !email) throw new ResearchError(503, "Research publishing is not configured");
  const auth = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_.-]+$/.test(auth) || auth.length > 16000) throw new ResearchError(401, "Publisher bearer token required");
  let payload: TokenPayload | undefined;
  try { payload = (await verifier.verifyIdToken({ idToken: auth.slice(7), audience })).getPayload(); }
  catch { throw new ResearchError(401, "Invalid or expired publisher token"); }
  return authorizeClaims(payload, { audience, sub, email });
}
