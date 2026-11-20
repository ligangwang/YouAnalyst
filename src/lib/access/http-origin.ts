// NextURL normalizes loopback IPs to localhost. Preserve the incoming HTTP
// authority for same-origin session checks and origin-bound release probes.
export function incomingOrigin(request: {headers:Headers;nextUrl:URL}): string | null {
  try { return new URL(`${request.nextUrl.protocol}//${request.headers.get('host') ?? request.nextUrl.host}`).origin; }
  catch { return null; }
}
