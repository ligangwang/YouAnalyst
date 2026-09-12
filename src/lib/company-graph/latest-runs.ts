import { getAdminFirestore } from "@/lib/firebase/admin";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "@/lib/company-graph/types";

export type LatestCompanyGraphRun = {
  symbol: string;
  name: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function listLatestCompanyGraphRuns(limit = 4): Promise<LatestCompanyGraphRun[]> {
  try {
    const snapshot = await getAdminFirestore()
      .collection("company_research_runs")
      .orderBy("updatedAt", "desc")
      .limit(25)
      .get();

    return snapshot.docs
      .flatMap((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const symbol = readString(data.ticker);
        const name = readString(data.companyName);

        if (
          !symbol ||
          data.status !== "COMPLETED" ||
          data.extractionVersion !== COMPANY_GRAPH_EXTRACTION_VERSION ||
          readNumber(data.edgeCount) <= 0
        ) {
          return [];
        }

        return [{
          symbol,
          name: name ?? symbol,
        }];
      })
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}
