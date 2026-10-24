import { loadCompanyFundamentals } from "@/lib/fundamentals/service";
import { CompanyFundamentalsLive } from "./company-fundamentals-live";

export async function CompanyFundamentalsLoader({ ticker, pending }: { ticker: string; pending?: ReturnType<typeof loadCompanyFundamentals> }) {
  const data = await (pending ?? loadCompanyFundamentals(ticker));
  return <CompanyFundamentalsLive key={ticker} ticker={ticker} initialData={data} />;
}
