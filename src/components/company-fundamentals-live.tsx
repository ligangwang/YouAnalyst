"use client";

import type { CompanyFundamentals } from "@/lib/fundamentals/model";
import { CompanyFundamentalsView } from "./company-fundamentals";

// Render the stored snapshot. Visitor navigation never starts or polls SEC work.
export function CompanyFundamentalsLive({ initialData }: { ticker: string; initialData: CompanyFundamentals | null }) {
  return <CompanyFundamentalsView data={initialData} />;
}
