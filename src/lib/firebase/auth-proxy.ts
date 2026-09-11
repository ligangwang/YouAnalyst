// A fixed allowlist prevents this public endpoint from becoming an open proxy.
const endpoints: Record<string, { host: string; method: string }> = {
  "identity/v1/accounts:signUp": { host: "identitytoolkit.googleapis.com", method: "POST" },
  "identity/v1/accounts:signInWithPassword": { host: "identitytoolkit.googleapis.com", method: "POST" },
  "identity/v1/accounts:lookup": { host: "identitytoolkit.googleapis.com", method: "POST" },
  "identity/v1/accounts:signInWithIdp": { host: "identitytoolkit.googleapis.com", method: "POST" },
  "identity/v1/projects": { host: "identitytoolkit.googleapis.com", method: "GET" },
  "identity/v2/recaptchaConfig": { host: "identitytoolkit.googleapis.com", method: "GET" },
  "identity/v2/passwordPolicy": { host: "identitytoolkit.googleapis.com", method: "GET" },
  "token/v1/token": { host: "securetoken.googleapis.com", method: "POST" },
};

const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function failure(status: number, message: string) {
  return Response.json({ error: { message } }, { status, headers: privateHeaders });
}

export async function proxyAuthRequest(request: Request, path: string[], apiKey: string | undefined) {
  const endpoint = endpoints[path.join("/")];
  if (!endpoint) return failure(404, "NOT_FOUND");
  if (request.method !== endpoint.method) return failure(405, "METHOD_NOT_ALLOWED");
  if (!apiKey) return failure(503, "INTERNAL_ERROR");
  const incoming = new URL(request.url);
  const origin = request.headers.get("origin");
  if ((origin && origin !== incoming.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return failure(403, "INVALID_ORIGIN");
  }
  const upstream = new URL(`https://${endpoint.host}/${path.slice(1).join("/")}`);
  for (const name of ["tenantId", "clientType", "version"]) {
    const value = incoming.searchParams.get(name);
    if (value) upstream.searchParams.set(name, value);
  }
  upstream.searchParams.set("key", apiKey);
  const headers = new Headers();
  for (const name of ["content-type", "x-client-version", "x-firebase-locale", "x-firebase-gmpid", "x-firebase-appcheck"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Preserve referrer-based restrictions on the existing Firebase web API key.
  headers.set("referer", `${incoming.origin}/`);
  let body: string | undefined;
  if (request.method === "POST") {
    // Bound even chunked request bodies without buffering arbitrary amounts.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32_768) {
          await reader.cancel();
          return failure(413, "PAYLOAD_TOO_LARGE");
        }
        chunks.push(value);
      }
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const response = await fetch(upstream, {
      method: request.method, headers, body, cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { ...privateHeaders, "Content-Type": "application/json" },
    });
  } catch {
    // Never log passwords, refresh tokens, or upstream response bodies.
    return failure(503, "INTERNAL_ERROR");
  }
}
