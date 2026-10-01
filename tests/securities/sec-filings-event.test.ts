import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecFilingDiscovered, parseSecFilingDiscovered, SEC_FINANCIAL_FORMS, secFilingEventId } from "../../src/lib/sec-filings/event";
import { parseSecFilingRows, parseSecSubmissions, parseSecTickerMapping } from "../../src/lib/sec-filings/source";

const input = { companyId: "AMD", cik: "0000002488", accessionNumber: "0000002488-26-000001", form: "10-K" as const,
  filingDate: "2026-09-27", primaryDocument: "amd-20260927.htm", isXbrl: true, discoveredAt: "2026-09-27T12:00:00Z" };
const event = createSecFilingDiscovered(input);
const columns = () => ({ accessionNumber: [input.accessionNumber], form: ["10-K"], filingDate: [input.filingDate],
  primaryDocument: [input.primaryDocument], isXBRL: [1], isInlineXBRL: [1] });

test("SEC filing contract has deterministic per-company identity and shared subscriber batch ID", () => {
  assert.deepEqual(parseSecFilingDiscovered(event), event);
  assert.equal(event.eventId, secFilingEventId(input.companyId, input.cik, input.accessionNumber));
  assert.equal(event.batchId, event.eventId);
  assert.equal(createSecFilingDiscovered({ ...input, discoveredAt: "2026-09-28T00:00:00Z" }).eventId, event.eventId);
  assert.notEqual(createSecFilingDiscovered({ ...input, companyId: "OTHER" }).eventId, event.eventId);
  for (const form of SEC_FINANCIAL_FORMS) assert.equal(createSecFilingDiscovered({ ...input, form }).form, form);
});
test("SEC filing boundary rejects unsafe, malformed, conflicting and incomplete events", () => {
  for (const change of [
    { version: 2 }, { type: "different" }, { companyId: "US:AMD" }, { companyId: "_worker" }, { companyId: "amd" },
    { cik: "2488" }, { cik: "0000000000" }, { accessionNumber: "../x" }, { form: "8-K" }, { filingDate: "2026-02-30" },
    { primaryDocument: "../private.html" }, { primaryDocument: "https://other.test/x" }, { primaryDocument: "file?x=1" },
    { eventId: "another", batchId: "another" }, { batchId: "different" }, { discoveredAt: "yesterday" },
    { discoveredAt: "2026-02-30T00:00:00Z" }, { isXbrl: undefined }, { isXbrl: "true" },
  ]) assert.throws(() => parseSecFilingDiscovered({ ...event, ...change }), /Invalid SEC filing/);
  assert.throws(() => parseSecFilingDiscovered(null));
});
test("SEC rows accept financial amendments and ignore nonfinancial filings", () => {
  const rows = SEC_FINANCIAL_FORMS.map((form, i) => ({ ...input, form, accessionNumber: `0000002488-26-${String(i).padStart(6, "0")}` }));
  const c = Object.fromEntries(["accessionNumber", "form", "filingDate", "primaryDocument"].map(key =>
    [key, rows.map(row => row[key as keyof typeof row])]));
  assert.equal(parseSecFilingRows({ ...c, isXBRL: rows.map(() => 1) }).length, 8);
  assert.deepEqual(parseSecFilingRows({ ...columns(), form: ["8-K"], isXBRL: undefined }), []);
});
test("SEC filing metadata fails closed instead of advancing past incomplete rows", () => {
  assert.throws(() => parseSecFilingRows({ ...columns(), filingDate: [] }), /columns/);
  assert.throws(() => parseSecFilingRows({ ...columns(), primaryDocument: [""] }), /Invalid SEC/);
  assert.throws(() => parseSecFilingRows({ ...columns(), isXBRL: undefined, isInlineXBRL: undefined }), /XBRL/);
  assert.throws(() => parseSecFilingRows({ ...columns(), isXBRL: undefined, isInlineXBRL: [0] }), /XBRL/);
  assert.throws(() => parseSecFilingRows({ ...columns(), isXBRL: [2] }), /XBRL/);
  assert.equal(parseSecFilingRows({ ...columns(), isXBRL: [0], isInlineXBRL: [0] })[0].isXbrl, false);
  assert.equal(parseSecFilingRows({ ...columns(), isXBRL: undefined, isInlineXBRL: [1] })[0].isXbrl, true);
});
test("submissions archive paths and date bounds are validated", () => {
  const file = { name: "CIK0000002488-submissions-001.json", filingFrom: "2024-01-01", filingTo: "2025-12-31" };
  assert.deepEqual(parseSecSubmissions({ cik: input.cik, filings: { recent: columns(), files: [file] } }, input.cik).files, [file]);
  for (const change of [{ name: "../../x.json" }, { name: "CIK9999999999-submissions-001.json" }, { filingTo: "2023-01-01" }]) {
    assert.throws(() => parseSecSubmissions({ cik: input.cik, filings: { recent: columns(), files: [{ ...file, ...change }] } }, input.cik));
  }
  assert.throws(() => parseSecSubmissions({ cik: input.cik, filings: { recent: columns() } }, input.cik));
});
test("SEC ticker mapping supports share-class aliases and rejects ambiguous identities", () => {
  assert.equal(parseSecTickerMapping({ fields: ["cik", "ticker"], data: [[1067983, "BRK-B"]] }).get("BRK.B"), "0001067983");
  assert.throws(() => parseSecTickerMapping({ fields: ["cik", "ticker"], data: [[1, "BRK-B"], [2, "BRK.B"]] }), /Ambiguous/);
  assert.throws(() => parseSecTickerMapping({ fields: ["cik", "ticker"], data: [["bad", "AMD"]] }), /CIK/);
});

test("submissions issuer mismatches and duplicate accession metadata fail closed", () => {
  assert.throws(() => parseSecSubmissions({ cik: "9999999999", filings: { recent: columns(), files: [] } }, input.cik), /CIK/);
  assert.throws(() => parseSecSubmissions({ filings: { recent: columns(), files: [] } }, input.cik), /CIK/);
  const first = columns();
  assert.throws(() => parseSecFilingRows({ accessionNumber: [first.accessionNumber[0], first.accessionNumber[0]],
    form: ["10-K", "10-Q"], filingDate: [input.filingDate, input.filingDate],
    primaryDocument: [input.primaryDocument, input.primaryDocument], isXBRL: [1, 1] }), /Conflicting/);
});
