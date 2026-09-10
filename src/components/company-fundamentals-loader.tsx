import { loadCompanyFundamentals } from "@/lib/fundamentals/service";
import { CompanyFundamentalsView } from "./company-fundamentals";

export async function CompanyFundamentalsLoader({ ticker }: { ticker: string }) {
  return <CompanyFundamentalsView data={await loadCompanyFundamentals(ticker)} />;
}
