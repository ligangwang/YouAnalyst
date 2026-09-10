import { canonicalPredictionStatus } from "./types";

export type CompanyCall = {
  id: string; watchlistId: string; watchlistName: string; isDefault: boolean; visibility: string;
  direction: "UP" | "DOWN"; status: "CREATED" | "OPEN" | "CLOSING";
  createdAt: string; entryDate: string | null; entryPrice: number | null; cancelUntil: string | null;
};
type RecordWithId = { id: string; data: Record<string, unknown> };
const text = (value: unknown) => typeof value === "string" ? value : "";

export function companyCallsForViewer(userId: string, ticker: string, predictions: RecordWithId[], watchlists: RecordWithId[]): CompanyCall[] {
  const owned = watchlists.filter(item => item.data.userId === userId);
  const byId = new Map(owned.map(item => [item.id, item.data]));
  const defaultId = owned.filter(item => !item.data.archivedAt)
    .sort((a, b) => text(a.data.createdAt).localeCompare(text(b.data.createdAt)) || a.id.localeCompare(b.id))[0]?.id;
  return predictions.flatMap(({ id, data }): CompanyCall[] => {
    const status = canonicalPredictionStatus(data.status);
    if (data.userId !== userId || data.ticker !== ticker || !["UP", "DOWN"].includes(text(data.direction)) || (status !== "CREATED" && status !== "OPEN" && status !== "CLOSING")) return [];
    const watchlistId = text(data.watchlistId), list = byId.get(watchlistId);
    const createdAt = text(data.createdAt), created = Date.parse(createdAt);
    return [{ id, watchlistId, watchlistName: text(list?.name) || text(data.watchlistName) || "Watchlist unavailable",
      isDefault: watchlistId === defaultId, visibility: data.visibility === "PRIVATE" ? "Private" : "Public",
      direction: data.direction as "UP" | "DOWN", status, createdAt,
      entryDate: text(data.entryDate) || null,
      entryPrice: typeof data.entryPrice === "number" && Number.isFinite(data.entryPrice) && data.entryPrice > 0 ? data.entryPrice : null,
      cancelUntil: status === "CREATED" && Number.isFinite(created) ? new Date(created + 5 * 60_000).toISOString() : null,
    }];
  }).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
