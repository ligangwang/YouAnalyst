import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { collectSecFilings, inspectSecFilingCollection } from "../../src/lib/sec-filings/collector";
import { createSecFilingDiscovered, type SecFilingDiscovered } from "../../src/lib/sec-filings/event";
import { persistSecFilingDiscovery, type SecCollectorCursor } from "../../src/lib/sec-filings/store";
import type { SecFiling, SecFilingsSource, SecSubmissions, SecSubmissionsFile } from "../../src/lib/sec-filings/source";

type Data = Record<string, unknown>;
const CIK = "0000002488";
const META = "company_fundamentals/_sec_filings_collector";
const COMPANY = "company_fundamentals/AMD";
const iso = "2026-09-27T12:00:00.000Z";
function filing(id = 1, date = "2026-09-27", form: SecFiling["form"] = "10-K"): SecFiling {
  return { accessionNumber: `0000002488-26-${String(id).padStart(6, "0")}`, filingDate: date, form,
    primaryDocument: `amd-${id}.htm`, isXbrl: true };
}
function cursor(lastCompleteAt = iso): SecCollectorCursor {
  return { version: 1, cik: CIK, baselineAt: "2026-01-01T00:00:00.000Z", lastCompleteAt, nextPollAfterMs: 0, scan: null };
}
function fixture(initial: Record<string, Data> = {}) {
  const documents = new Map<string, Data>(Object.entries(initial));
  let time = Date.parse(iso);
  let writes = 0;
  let onWrite: ((path: string, data: Data) => void) | undefined;
  const merge = (before: Data, update: Data): Data => {
    const result = { ...before };
    for (const [key, value] of Object.entries(update)) {
      if (value && typeof value === "object" && value.constructor.name === "DeleteTransform") { delete result[key]; continue; }
      result[key] = value && typeof value === "object" && !Array.isArray(value)
        ? merge((before[key] ?? {}) as Data, value as Data) : structuredClone(value);
    }
    return result;
  };
  const snap = (path: string) => ({ id: path.split("/").at(-1)!, exists: documents.has(path),
    data: () => documents.has(path) ? structuredClone(documents.get(path)) : undefined,
    get: (key: string) => structuredClone(documents.get(path)?.[key]) });
  const write = (path: string, data: Data) => {
    onWrite?.(path, data);
    writes++;
    documents.set(path, merge(documents.get(path) ?? {}, data));
  };
  const ref = (path: string) => ({ id: path.split("/").at(-1)!, path, firestore: db,
    get: async () => snap(path), set: async (data: Data) => write(path, data) });
  let transactionQueue = Promise.resolve();
  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ref(`${collection}/${id}`),
      where: (field: string, op: string, value: unknown) => {
        assert.equal(op, "==");
        let after = "", limit = 100;
        const query = {
          orderBy: () => query,
          startAfter: (id: string) => { after = id; return query; },
          limit: (n: number) => { limit = n; return query; },
          get: async () => {
            const docs = [...documents].filter(([path, data]) => path.startsWith(`${collection}/`)
              && path.slice(collection.length + 1) > after && data[field] === value).sort(([a], [b]) => a.localeCompare(b))
              .slice(0, limit).map(([path]) => snap(path));
            return { docs, size: docs.length, empty: docs.length === 0 };
          },
        };
        return query;
      },
    }),
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
      const work = transactionQueue.then(async () => {
        const pending: { path: string; data: Data }[] = [];
        const result = await fn({ get: async (r: ReturnType<typeof ref>) => r.get(),
          set: (r: ReturnType<typeof ref>, data: Data) => { pending.push({ path: r.path, data }); } });
        for (const item of pending) write(item.path, item.data);
        return result;
      });
      transactionQueue = work.then(() => undefined, () => undefined);
      return work;
    },
  } as unknown as Firestore;
  const logs: Data[] = [];
  const log = { runId: "collector-test", emit: (level: string, event: string, fields: Data) => logs.push({ level, event, ...fields }) } as unknown as MaintenanceLog;
  const events: SecFilingDiscovered[] = [], requests: string[] = [];
  let submissions: SecSubmissions = { recent: [filing()], files: [] };
  const archives = new Map<string, SecFiling[]>();
  const source: SecFilingsSource = {
    async resolveCik(id) { requests.push(`resolve:${id}`); return CIK; },
    async submissions(cik) { requests.push(`submissions:${cik}`); return structuredClone(submissions); },
    async archive(_cik, name) { requests.push(`archive:${name}`); return structuredClone(archives.get(name) ?? []); },
  };
  const publish = async (event: SecFilingDiscovered) => {
    const saved = documents.get(`sec_filings/${event.accessionNumber}`)?.discoveryEvents as Data;
    assert.ok(saved[event.eventId], "event must be persisted before publication");
    events.push(event);
    return `message-${events.length}`;
  };
  const options = () => ({ source, publish, now: () => time, deadline: time + 12 * 60_000 });
  return { db, documents, log, logs, events, requests, source, publish, options, archives,
    run: (ids = ["AMD"], overrides: Partial<ReturnType<typeof options>> & { maxCompanies?: number; maxArchivePagesPerCompany?: number } = {}) =>
      collectSecFilings(db, ids, log, { ...options(), ...overrides }),
    now: () => time, advance: (ms: number) => { time += ms; }, writes: () => writes,
    setSubmissions: (s: SecSubmissions) => { submissions = s; },
    onWrite: (callback?: (path: string, data: Data) => void) => { onWrite = callback; } };
}
function discoveries(f: ReturnType<typeof fixture>, id: number) {
  return f.documents.get(`sec_filings/${filing(id).accessionNumber}`)?.discoveryEvents as Record<string, { state: string; event: SecFilingDiscovered }>;
}

test("collector first observation records baseline without historical events or extraction field loss", async () => {
  const f = fixture({ [`sec_filings/${filing().accessionNumber}`]: { companyGraphLatestResult: { expensive: true }, ticker: "AMD" },
    [COMPANY]: { value: { metrics: { revenue: 10 } }, pending: true } });
  const result = await f.run();
  assert.equal(result.baselined, 1); assert.equal(result.discovered, 0); assert.equal(f.events.length, 0);
  assert.equal(Object.values(discoveries(f, 1))[0].state, "baseline");
  assert.deepEqual(f.documents.get(`sec_filings/${filing().accessionNumber}`)?.companyGraphLatestResult, { expensive: true });
  assert.deepEqual(f.documents.get(COMPANY)?.value, { metrics: { revenue: 10 } });
  assert.equal(f.documents.get(COMPANY)?.pending, true);
  assert.equal((f.documents.get(COMPANY)?.secFilingsCollector as SecCollectorCursor).lastCompleteAt, iso);
});
test("new same-day filing publishes once, with stable identity and no duplicate confirmed publication", async () => {
  const f = fixture();
  await f.run();
  f.advance(16 * 60_000);
  f.setSubmissions({ recent: [filing(2), filing(1)], files: [] });
  const result = await f.run();
  assert.equal(result.discovered, 1); assert.equal(result.published, 1);
  assert.equal(f.events[0].accessionNumber, filing(2).accessionNumber);
  f.advance(16 * 60_000);
  await f.run();
  assert.equal(f.events.length, 1);
  assert.equal(Object.values(discoveries(f, 2))[0].state, "published");
});
test("outbox failure retries publication without another SEC request and never replays completed events", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: cursor() } });
  await assert.rejects(f.run(["AMD"], { publish: async () => { throw new Error("publisher outage"); } }), /publisher outage/);
  const requestCount = f.requests.length;
  assert.equal(Object.values(discoveries(f, 1))[0].state, "pending");
  await f.run();
  assert.equal(f.requests.length, requestCount); assert.equal(f.events.length, 1);
  await f.run();
  assert.equal(f.requests.length, requestCount); assert.equal(f.events.length, 1);
});
test("persistent publisher outage prevents further discovery calls", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: cursor() } });
  const publish = async () => { throw new Error("publisher outage"); };
  await assert.rejects(f.run(["AMD"], { publish }));
  f.advance(60 * 60_000);
  const count = f.requests.length;
  await assert.rejects(f.run(["AMD"], { publish }));
  assert.equal(f.requests.length, count);
});
test("multiple US listings sharing one accession keep independent events in the existing filing document", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: cursor() }, "company_fundamentals/OTHER": { secFilingsCollector: cursor() } });
  await f.run(["AMD", "OTHER"]);
  assert.equal(f.events.length, 2);
  assert.equal(new Set(f.events.map(event => event.eventId)).size, 2);
  assert.equal(Object.keys(discoveries(f, 1)).length, 2);
  assert.ok(Object.values(discoveries(f, 1)).every(record => record.state === "published"));
});
test("downtime uses overlapping archive pages and resumes completed pages without refetching", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: cursor("2025-01-15T00:00:00Z") } });
  const archive = (n: number, from: string, to: string): SecSubmissionsFile => ({ name: `CIK${CIK}-submissions-${n}.json`, filingFrom: from, filingTo: to });
  const old = archive(1, "2020-01-01", "2024-01-01"), a = archive(2, "2024-12-01", "2025-06-30"), b = archive(3, "2025-07-01", "2025-12-31");
  f.archives.set(a.name, [filing(2, "2025-02-01"), filing(99, "2024-01-01")]);
  f.archives.set(b.name, [filing(3, "2025-10-01")]);
  f.setSubmissions({ recent: [filing()], files: [b, old, a] });
  const first = await f.run(["AMD"], { maxArchivePagesPerCompany: 1 });
  assert.equal(first.partial, 1); assert.equal(first.completed, 0);
  assert.equal((f.documents.get(COMPANY)?.secFilingsCollector as SecCollectorCursor).lastCompleteAt, "2025-01-15T00:00:00Z");
  const second = await f.run();
  assert.equal(second.completed, 1);
  assert.equal(f.requests.filter(request => request === `archive:${a.name}`).length, 1);
  assert.equal(f.requests.filter(request => request === `archive:${b.name}`).length, 1);
  assert.equal(f.requests.filter(request => request === `archive:${old.name}`).length, 0);
  assert.equal(f.events.length, 3); assert.equal(discoveries(f, 99), undefined);
});
test("interrupted baseline freezes original rows and emits new same-day filings on retry", async () => {
  const f = fixture();
  let crash = true;
  f.onWrite((path) => { if (path.startsWith("sec_filings/") && crash) { crash = false; throw new Error("interrupted"); } });
  assert.equal((await f.run()).failed, 1);
  const saved = f.documents.get(COMPANY)?.secFilingsCollector as SecCollectorCursor;
  assert.deepEqual(saved.scan?.baselineFilings, [filing(1)]);
  // The original row may already have moved off recent after an interruption.
  f.setSubmissions({ recent: [filing(2)], files: [] });
  const result = await f.run();
  assert.equal(result.baselined, 1); assert.equal(result.discovered, 1);
  assert.equal(Object.values(discoveries(f, 1))[0].state, "baseline");
  assert.equal(f.events[0].accessionNumber, filing(2).accessionNumber);
});
test("oversized baseline fails closed before ledger writes or watermark advancement", async () => {
  const f = fixture();
  f.setSubmissions({ recent: Array.from({ length: 1500 }, (_, i) => ({ ...filing(i), primaryDocument: `${"x".repeat(220)}.htm` })), files: [] });
  const result = await f.run();
  assert.equal(result.failed, 1);
  assert.equal(f.events.length, 0);
  assert.equal([...f.documents.keys()].filter(key => key.startsWith("sec_filings/")).length, 0);
  assert.equal((f.documents.get(COMPANY)?.secFilingsCollector as SecCollectorCursor).lastCompleteAt, null);
});
test("date overlap preserves a late same-day accession and watermark uses scan start", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: cursor("2026-09-26T00:00:00Z") } });
  f.setSubmissions({ recent: [filing(1, "2026-09-20")], files: [] });
  const source = { ...f.source, submissions: async (cik: string) => { f.advance(10_000); return f.source.submissions(cik); } };
  await f.run(["AMD"], { source });
  assert.equal(f.events.length, 1);
  assert.equal((f.documents.get(COMPANY)?.secFilingsCollector as SecCollectorCursor).lastCompleteAt, iso);
});
test("rotation and bounded work avoid starving companies, and SEC blocks stop further requests", async () => {
  const f = fixture();
  await f.run(["AMD", "BBB", "CCC"], { maxCompanies: 1 });
  await f.run(["AMD", "BBB", "CCC"], { maxCompanies: 1 });
  assert.deepEqual(f.requests.filter(request => request.startsWith("resolve:")), ["resolve:AMD", "resolve:BBB"]);
  assert.equal(f.documents.get(META)?.afterCompanyId, "BBB");
  const source = { ...f.source, resolveCik: async () => { throw Object.assign(new Error("cooldown"), { code: 429 }); } };
  const result = await f.run(["AMD", "BBB", "CCC"], { source });
  assert.equal(result.failed, 1); assert.equal(result.inspected, 1);
});
test("lease contention and exhausted time budget do no SEC or publication work", async () => {
  const f = fixture({ [META]: { leaseOwner: "another", leaseExpiresAtMs: Date.parse(iso) + 60_000 } });
  await assert.rejects(f.run(), /busy/);
  f.documents.delete(META);
  const result = await f.run(["AMD"], { deadline: f.now() });
  assert.equal(result.outboxIncomplete, true); assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
});
test("read-only dry run has no provider, publication, lease or other writes", async () => {
  const f = fixture();
  const result = await inspectSecFilingCollection(f.db, ["AMD"]);
  assert.equal(result.dryRun, true); assert.equal(result.needingBaseline, 1);
  assert.equal(f.writes(), 0); assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
});
test("filing ledger rejects changed immutable metadata while preserving extraction results", async () => {
  const f = fixture();
  const event = createSecFilingDiscovered({ ...filing(), companyId: "AMD", cik: CIK, discoveredAt: iso });
  await persistSecFilingDiscovery(f.db, event, false);
  for (const change of [{ form: "10-Q" as const }, { filingDate: "2026-09-26" }, { primaryDocument: "other.htm" }, { isXbrl: false }]) {
    await assert.rejects(persistSecFilingDiscovery(f.db, { ...event, ...change }, false), /conflict/);
  }
  assert.equal(await persistSecFilingDiscovery(f.db, { ...event, discoveredAt: "2026-10-01T00:00:00Z" }, false), "existing");
  assert.equal(Object.values(discoveries(f, 1))[0].event.discoveredAt, iso);
});
test("collector CLI is disabled by default and SEC transport uses only the shared budget", () => {
  const script = readFileSync("scripts/collect-sec-filings.ts", "utf8");
  assert.match(script, /args\.includes\("--apply"\)/);
  assert.match(script, /SEC_FILINGS_COLLECTOR_ENABLED !== "1"/);
  assert.match(script, /inspectSecFilingCollection/);
  const source = readFileSync("src/lib/sec-filings/source.ts", "utf8");
  assert.match(source, /secRequest\(url/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test("partial outbox outage retries only unsent events, including removed graph tickers", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: { ...cursor(), nextPollAfterMs: Date.parse(iso) + 60_000 } } });
  for (const id of [1, 2]) await persistSecFilingDiscovery(f.db, createSecFilingDiscovered({ ...filing(id),
    companyId: "REMOVED", cik: CIK, discoveredAt: iso }), false);
  let attempt = 0;
  await assert.rejects(f.run(["AMD"], { publish: async event => {
    if (++attempt === 2) throw new Error("second publication failed");
    return f.publish(event);
  } }), /second publication failed/);
  await f.run();
  assert.deepEqual(f.events.map(event => event.accessionNumber), [filing(1).accessionNumber, filing(2).accessionNumber]);
  assert.ok(f.events.every(event => event.companyId === "REMOVED"));
  assert.equal(f.requests.length, 0);
});
test("an uncertain publication checkpoint replays the exact persisted event identity", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: cursor() } });
  let fail = true;
  f.onWrite((path, data) => {
    if (fail && path.startsWith("sec_filings/") && JSON.stringify(data).includes('"state":"published"')) {
      fail = false;
      throw new Error("checkpoint failed");
    }
  });
  await assert.rejects(f.run(), /checkpoint failed/);
  await f.run();
  assert.equal(f.events.length, 2);
  assert.deepEqual(f.events[1], f.events[0]);
  assert.equal(Object.values(discoveries(f, 1))[0].state, "published");
});
test("outbox query paginates past 100 filings without repeating confirmed entries", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: { ...cursor(), nextPollAfterMs: Date.parse(iso) + 60_000 } } });
  for (let id = 0; id < 105; id++) await persistSecFilingDiscovery(f.db, createSecFilingDiscovered({ ...filing(id),
    companyId: "AMD", cik: CIK, discoveredAt: iso }), false);
  const result = await f.run();
  assert.equal(result.published, 105); assert.equal(new Set(f.events.map(event => event.eventId)).size, 105);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.run()).published, 0);
});
test("time exhaustion persists unfinished company cursor and does not advance its watermark", async () => {
  const f = fixture({ [COMPANY]: { secFilingsCollector: cursor() } });
  f.setSubmissions({ recent: [filing(1), filing(2)], files: [] });
  f.onWrite(path => { if (path === `sec_filings/${filing(1).accessionNumber}`) f.advance(12 * 60_000); });
  const result = await f.run();
  assert.equal(result.partial, 1); assert.equal(result.outboxIncomplete, true);
  assert.equal((f.documents.get(COMPANY)?.secFilingsCollector as SecCollectorCursor).lastCompleteAt, iso);
  assert.notEqual((f.documents.get(COMPANY)?.secFilingsCollector as SecCollectorCursor).scan, null);
  assert.equal(f.events.length, 0);
  f.onWrite();
  assert.equal((await f.run()).completed, 1);
  assert.equal(f.events.length, 2);
});

test("a sibling listing cannot assign conflicting XBRL metadata to an existing accession", async () => {
  const f = fixture();
  await persistSecFilingDiscovery(f.db, createSecFilingDiscovered({ ...filing(), companyId: "AMD", cik: CIK, discoveredAt: iso }), false);
  await assert.rejects(persistSecFilingDiscovery(f.db, createSecFilingDiscovered({ ...filing(), isXbrl: false,
    companyId: "OTHER", cik: CIK, discoveredAt: iso }), false), /conflicts across listings/);
});
