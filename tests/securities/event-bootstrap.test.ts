import assert from "node:assert/strict";
import test from "node:test";
import { historicalFilingInput, bootstrapPublicEvents } from "../../src/lib/events/bootstrap";
import type { Firestore } from "firebase-admin/firestore";

const filing = { status: "PARSED", filingDate: "2026-04-01", filingUrl: "https://www.sec.gov/Archives/edgar/data/1/filing.txt", form: "4" };
const transaction = { accessionNumber: "0000000001-26-000001", issuerName: "Example", ticker: "AMD" };

test("initial import uses processed source facts and preserves the historical filing date", () => {
  const input = historicalFilingInput(transaction, "SEC_FORM4", filing)!;
  assert.equal(input.filingDate, "2026-04-01");
  assert.equal(input.entityName, "Example");
  assert.deepEqual(input.tickers, ["AMD"]);
  assert.equal(historicalFilingInput(transaction, "SEC_FORM4", { ...filing, status: "FAILED" }), null);
  assert.equal(historicalFilingInput(transaction, "SEC_FORM4"), null);
  assert.equal(historicalFilingInput(transaction, "SEC_FORM4", { ...filing, filingUrl: "https://evil.test" }), null);
  const institution = { ...transaction, managerName: "Fund", infoTableUrl: filing.filingUrl, filingDate: filing.filingDate, holdingsComplete: true, form: "13F-HR" };
  assert.equal(historicalFilingInput(institution, "SEC_13F")?.entityName, "Fund");
  assert.equal(historicalFilingInput({ ...institution, holdingsComplete: false }, "SEC_13F"), null);
});

test("already-populated streams are not backfilled or rewritten", async () => {
  const db = { collection: (name: string) => {
    assert.equal(name, "events");
    return { limit: (limit: number) => { assert.equal(limit, 1); return { get: async () => ({ empty: false }) }; } };
  } } as unknown as Firestore;
  assert.deepEqual(await bootstrapPublicEvents(db), { created: 0, alreadyPopulated: true });
});

test("empty streams import once per accession and tolerate a concurrent publisher", async () => {
  const written: Record<string, unknown>[] = [];
  let concurrent = false;
  const db = { collection: (name: string) => {
    const query = { orderBy: () => query, limit: () => query, get: async () => name === "events" ? { empty: true } : { docs: name === "insider_transactions" ? [{ data: () => transaction }, { data: () => transaction }] : [] }, doc: (id: string) => ({ id, create: async (event: Record<string, unknown>) => { if (concurrent) throw Object.assign(new Error("Already exists"), { code: 6 }); written.push(event); } }) };
    return query;
  }, getAll: async () => [{ id: transaction.accessionNumber, data: () => filing }] } as unknown as Firestore;
  assert.equal((await bootstrapPublicEvents(db)).created, 1);
  assert.equal(written.length, 1);
  assert.equal(written[0].occurredAt, filing.filingDate);
  assert.notEqual(written[0].publishedAt, filing.filingDate);
  concurrent = true;
  assert.equal((await bootstrapPublicEvents(db)).created, 0);
  assert.equal(written.length, 1);
});
