import { loadCompanyFundamentals } from "@/lib/fundamentals/service";
import { CompanyFundamentalsLive } from "./company-fundamentals-live";
import { after } from "next/server";
import { dispatchRequestedFundamentals } from "@/lib/fundamentals/dispatch";

export async function CompanyFundamentalsLoader({ ticker }: { ticker: string }) {
  const data = await loadCompanyFundamentals(ticker);
  after(() => dispatchRequestedFundamentals(ticker));
  return <CompanyFundamentalsLive key={ticker} ticker={ticker} initialData={data} />;
}
