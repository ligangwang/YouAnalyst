import { savedCompanyTickers } from "./industry-graph/saved-companies";

export async function saveCompanyToAccount(ticker: string, getToken: () => Promise<string | null>, saved = true) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const token = await getToken();
    if (!token) throw new Error("Sign in again to save this company.");
    const response = await fetch("/api/industry-graph/saved", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, saved }), signal: controller.signal,
    });
    if (!response.ok) throw new Error("Could not confirm the change. Please retry.");
    const payload = await response.json();
    if (!Array.isArray(payload.tickers)) throw new Error("Could not confirm the change. Please retry.");
    const tickers = savedCompanyTickers(payload.tickers);
    if (tickers.includes(ticker) !== saved) throw new Error("Could not confirm the change. Please retry.");
    return tickers;
  } finally { clearTimeout(timeout); }
}
