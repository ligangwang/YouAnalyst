export const scheduledJobs = {
  fundamentals: { name: "SEC fundamentals", scheduler: "refresh-sec-fundamentals-production", worker: "refresh-sec-fundamentals-production", logJob: "refresh-sec-fundamentals", schedule: "Daily, 9 PM New York" },
  cnFundamentals: { name: "A-share share counts and market caps", scheduler: "refresh-cn-fundamentals-production", worker: "refresh-cn-fundamentals-production", logJob: "refresh-cn-fundamentals", schedule: "Weekdays, 9:30 AM New York (after China EOD)" },
  directory: { name: "China company directory", scheduler: "sync-cni-directory-production", worker: "sync-cni-directory-production", logJob: "sync-cni-directory", schedule: "Monday, 02:20 UTC" },
  us: { name: "US end-of-day maintenance", scheduler: "daily-eod-maintenance-production", worker: null, logJob: "daily-eod-maintenance", market: "US", schedule: "Weekdays, 8 PM New York" },
  china: { name: "China end-of-day maintenance", scheduler: "daily-eod-maintenance-production-cn-a", worker: null, logJob: "daily-eod-maintenance", market: "CN_A", schedule: "Weekdays, 8 AM New York" },
} as const;
export type JobId = keyof typeof scheduledJobs;
export type HistoryView = "runs" | "errors" | "logs" | "scheduler";
export type JobRecord = {
  id: string; startedAt: string; endedAt?: string; status: string; durationMs?: number;
  summary: Record<string, unknown>; runId?: string; execution?: string; message?: string;
};
export type JobHistoryPage = { records: JobRecord[]; nextPageToken: string | null; warning?: string };
