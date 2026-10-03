import { createHash } from "node:crypto";

export const SEC_FILINGS_TOPIC = "sec-filings-discovered";
export const SEC_FINANCIAL_FORMS = ["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A"] as const;
export type SecFinancialForm = typeof SEC_FINANCIAL_FORMS[number];
export type SecFilingDiscovered = {
  version: 1;
  type: "sec.filing.discovered";
  eventId: string;
  /** The common subscriber helper uses batchId for logs and delivery correlation. */
  batchId: string;
  companyId: string;
  cik: string;
  accessionNumber: string;
  form: SecFinancialForm;
  filingDate: string;
  primaryDocument: string;
  isXbrl: boolean;
  discoveredAt: string;
  /** Source SEC acceptance time; legacy messages can omit it. */
  published_at?: string | null;
  collected_at?: string;
};

export function isSecFilingDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function isSecFinancialForm(value: unknown): value is SecFinancialForm {
  return SEC_FINANCIAL_FORMS.includes(value as SecFinancialForm);
}
export function secFilingEventId(companyId: string, cik: string, accessionNumber: string) {
  // Include the ticker: two US listings of one issuer each need their own refresh.
  return `sec_${createHash("sha256").update(JSON.stringify([companyId, cik, accessionNumber])).digest("hex")}`;
}
export function parseSecFilingDiscovered(value: unknown): SecFilingDiscovered {
  const v = value as Partial<SecFilingDiscovered> | null;
  if (!v || v.version !== 1 || v.type !== "sec.filing.discovered"
    || typeof v.eventId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.eventId) || v.batchId !== v.eventId
    || typeof v.companyId !== "string" || !/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(v.companyId)
    || typeof v.cik !== "string" || !/^\d{10}$/.test(v.cik) || Number(v.cik) === 0
    || typeof v.accessionNumber !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(v.accessionNumber)
    || !isSecFinancialForm(v.form) || !isSecFilingDate(v.filingDate)
    || typeof v.isXbrl !== "boolean"
    || typeof v.primaryDocument !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(v.primaryDocument)
    || v.primaryDocument.includes("..")
    || typeof v.discoveredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v.discoveredAt)
    || !Number.isFinite(Date.parse(v.discoveredAt)) || !isSecFilingDate(v.discoveredAt.slice(0, 10))) {
    throw new Error("Invalid SEC filing discovered event");
  }
  if (v.eventId !== secFilingEventId(v.companyId, v.cik, v.accessionNumber)) throw new Error("Invalid SEC filing event identity");
  return { version: 1, type: "sec.filing.discovered", eventId: v.eventId, batchId: v.eventId,
    companyId: v.companyId, cik: v.cik, accessionNumber: v.accessionNumber, form: v.form,
    filingDate: v.filingDate, primaryDocument: v.primaryDocument, isXbrl: v.isXbrl, discoveredAt: v.discoveredAt,
    published_at: sourcePublication(v.published_at), collected_at: v.discoveredAt };
}

/** A SEC source datetime must have an explicit timezone. */
export function sourcePublication(value:unknown):string|null {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!isSecFilingDate(value.slice(0,10))||!Number.isFinite(Date.parse(value)))return null;
  return new Date(value).toISOString();
}

export function createSecFilingDiscovered(input: Omit<SecFilingDiscovered, "version" | "type" | "eventId" | "batchId">) {
  const eventId = secFilingEventId(input.companyId, input.cik, input.accessionNumber);
  return parseSecFilingDiscovered({ ...input, version: 1, type: "sec.filing.discovered", eventId, batchId: eventId });
}
