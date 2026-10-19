"use client";

import type { CompanyFundamentals } from "@/lib/fundamentals/model";
import { CompanyFundamentalsView } from "./company-fundamentals";

// Render the stored snapshot. The scheduled worker handles queued misses; do not poll on navigation.
export function CompanyFundamentalsLive({ initialData }: { ticker: string; initialData: CompanyFundamentals | null }) {
  return <CompanyFundamentalsView data={initialData} />;
}
