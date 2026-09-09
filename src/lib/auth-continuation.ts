/** Accept only same-site paths before passing a continuation to the router. */
export function safeAuthDestination(requested: string | null | undefined): string | null {
  if (!requested?.startsWith("/") || requested.startsWith("//")) return null;

  try {
    const base = "https://youanalyst.invalid";
    const url = new URL(requested, base);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.origin !== base ||
      url.pathname.startsWith("//") ||
      decodedPath.startsWith("//") ||
      requested.split(/[?#]/u)[0].includes("\\") ||
      Array.from(requested.split(/[?#]/u)[0]).some((char) => char.charCodeAt(0) <= 32) ||
      decodedPath.includes("\\") ||
      Array.from(decodedPath).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ) return null;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function predictionSignInHref(ticker: string, watchlistId: string, direction?: "UP" | "DOWN"): string {
  const query = new URLSearchParams();
  if (ticker) query.set("ticker", ticker);
  if (watchlistId) query.set("watchlistId", watchlistId);
  if (direction) query.set("direction", direction);
  const destination = `/predictions/new${query.size ? `?${query}` : ""}`;
  return `/auth?${new URLSearchParams({ next: destination })}`;
}
