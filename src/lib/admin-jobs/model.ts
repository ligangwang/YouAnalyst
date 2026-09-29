export const scheduledJobs = {
  tickers: { name: "Ticker catalog", scheduler: null, worker: null, logJob: "sync-tickers", schedule: "Manual" },
  privateValuations: { name: "Private company valuations", scheduler: "refresh-private-valuations-production", worker: "refresh-private-valuations-production", logJob: "refresh-private-valuations", schedule: "Monthly, day 1 at 9 AM New York" },
  privateValuationChecks: { name: "Private valuation checks", scheduler: null, worker: null, logJob: "private-valuation-check", schedule: "Processes queued company checks; failures retry independently" },
  fundamentals: { name: "SEC fundamentals", scheduler: "refresh-sec-fundamentals-production", worker: "refresh-sec-fundamentals-production", logJob: "refresh-sec-fundamentals", schedule: "Daily, 9 PM New York" },
  fundamentalsBatches: { name: "SEC fundamentals batches", scheduler: null, worker: null, logJob: "sec-fundamentals-batch", schedule: "Processes published company batches; retries resume unfinished companies" },
  cnFundamentals: { name: "A-share financials and market caps", scheduler: "refresh-cn-fundamentals-production", worker: "refresh-cn-fundamentals-production", logJob: "refresh-cn-fundamentals", schedule: "Weekdays, 9:30 AM New York (after China EOD)" },
  cnFundamentalsChecks: { name: "A-share fundamentals checks", scheduler: null, worker: null, logJob: "cn-fundamentals-check", schedule: "Processes queued companies; incomplete sources retry" },
  directoryImports: { name: "China directory imports", scheduler: null, worker: null, logJob: "cni-directory-import", schedule: "Imports validated snapshots; retries resume unfinished batches" },
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
