import { loadCompanyFundamentals } from "@/lib/fundamentals/service";
import { CompanyFundamentalsLive } from "./company-fundamentals-live";

export async function CompanyFundamentalsLoader({ ticker }: { ticker: string }) {
  const data = await loadCompanyFundamentals(ticker);
  return <CompanyFundamentalsLive key={ticker} ticker={ticker} initialData={data} />;
}
