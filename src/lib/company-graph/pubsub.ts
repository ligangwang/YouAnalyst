import { createHash } from "node:crypto";
import { publishJobMessage } from "../job-pubsub";
import { parseSecFilingDiscovered, isSecFilingDate, type SecFilingDiscovered } from "../sec-filings/event";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "./types";

export type CompanyGraphRequest = {
  version: 1;
  type: "company.graph.extract.requested";
  batchId: string;
  requestId: string;
  ticker: string;
  generation: number;
  requestedAt: string;
  force: boolean;
};
export type CompanyGraphJob = CompanyGraphRequest | CompanyGraphVerification | SecFilingDiscovered;
export function companyGraphRequestId(ticker: string, generation: number) {
  return `graph_${createHash("sha256").update(JSON.stringify([ticker, generation, COMPANY_GRAPH_EXTRACTION_VERSION])).digest("hex")}`;
}
export function parseCompanyGraphRequest(value: unknown): CompanyGraphRequest {
  const v = value as Partial<CompanyGraphRequest> | null;
  if (!v || v.version !== 1 || v.type !== "company.graph.extract.requested"
    || typeof v.ticker !== "string" || !/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(v.ticker)
    || !Number.isSafeInteger(v.generation) || Number(v.generation) < 1
    || v.requestId !== companyGraphRequestId(v.ticker, Number(v.generation)) || v.batchId !== v.requestId
    || typeof v.force !== "boolean" || typeof v.requestedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v.requestedAt)
    || !Number.isFinite(Date.parse(v.requestedAt)) || !isSecFilingDate(v.requestedAt.slice(0, 10))) throw new Error("Invalid company graph request");
  return { version: 1, type: "company.graph.extract.requested", batchId: v.requestId,
    requestId: v.requestId, ticker: v.ticker, generation: v.generation!, requestedAt: v.requestedAt, force: v.force };
}
export function parseCompanyGraphFiling(value: unknown): CompanyGraphJob {
  // Non-10-K events are valid transport messages and are acknowledged as skipped.
  return parseSecFilingDiscovered(value);
}
export const publishCompanyGraphRequest = (request: CompanyGraphRequest) => {
  const topic = process.env.COMPANY_GRAPH_REQUEST_TOPIC;
  if (!topic) throw new Error("COMPANY_GRAPH_REQUEST_TOPIC is required to publish graph work");
  return publishJobMessage(topic, request);
};

export type CompanyGraphVerification = {
  version: 1; type: "company.graph.verify.requested"; batchId: string; ticker: string; expectedRunId: string;
};
export function parseCompanyGraphManualJob(value: unknown): CompanyGraphRequest | CompanyGraphVerification {
  const v = value as Partial<CompanyGraphVerification> | null;
  if (v?.type !== "company.graph.verify.requested") return parseCompanyGraphRequest(value);
  if (v.version !== 1 || typeof v.batchId !== "string" || !/^verify_[A-Za-z0-9_-]{1,100}$/.test(v.batchId)
    || typeof v.ticker !== "string" || !/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(v.ticker)
    || typeof v.expectedRunId !== "string" || !/^[A-Za-z0-9_.-]{1,200}$/.test(v.expectedRunId)) throw new Error("Invalid company graph verification request");
  return { version: 1, type: "company.graph.verify.requested", batchId: v.batchId, ticker: v.ticker, expectedRunId: v.expectedRunId };
}
