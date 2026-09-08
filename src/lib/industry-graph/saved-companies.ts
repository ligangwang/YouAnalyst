import { isMapTicker } from "./directory";
export function savedCompanyTickers(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isMapTicker))] : [];
}

export function mapSignInHref(ticker: string) {
  return `/auth?${new URLSearchParams({ next: `/?${new URLSearchParams({ company: ticker })}`, mode: "register" })}`;
}

export function mapAuthCompany(destination: string | null) {
  if (!destination) return null;
  const url = new URL(destination, "https://youanalyst.invalid");
  const ticker = url.searchParams.get("company");
  return url.origin === "https://youanalyst.invalid" && url.pathname === "/" && isMapTicker(ticker) ? ticker : null;
}

type Dependencies<RequestType extends Request> = {
  authenticate: (request: RequestType) => Promise<{ uid: string } | null>;
  read: (uid: string) => Promise<unknown>;
  update: (uid: string, ticker: string, saved: boolean) => Promise<unknown>;
  exists: (ticker: string) => Promise<boolean>;
};

// Identity always comes from the verified token. Never accept an owner from the client.
export function createSavedCompanyHandlers<RequestType extends Request>(deps: Dependencies<RequestType>) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  return {
    async GET(request: RequestType) {
      try {
        const user = await deps.authenticate(request);
        if (!user) return reply({ error: "Sign in to view saved companies." }, 401);
        return reply({ tickers: savedCompanyTickers(await deps.read(user.uid)) });
      } catch { return reply({ error: "Saved companies are temporarily unavailable." }, 503); }
    },
    async POST(request: RequestType) {
      try {
        const user = await deps.authenticate(request);
        if (!user) return reply({ error: "Sign in to save a company." }, 401);
        const input = await request.json().catch(() => null);
        if (!input || typeof input !== "object" || !isMapTicker(input.ticker) || typeof input.saved !== "boolean" || (input.saved && !await deps.exists(input.ticker))) {
          return reply({ error: "Choose a supported map company and a save action." }, 400);
        }
        return reply({ tickers: savedCompanyTickers(await deps.update(user.uid, input.ticker, input.saved)) });
      } catch { return reply({ error: "Could not update saved companies. Please try again." }, 503); }
    },
  };
}
