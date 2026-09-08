import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { createGraphRepository } from "../../src/lib/graph/repository";

type Row = Record<string, unknown>;
type Database = Record<string, Record<string, Row>>;

// A read-only Firestore double. No credentials, network calls, or write methods.
function fixture(database: Database) {
  const reads: string[] = [];
  function collection(name: string) {
    const rows = Object.entries(database[name] ?? {});
    const doc = ([id, data]: [string, Row]) => ({ id, exists: true, data: () => data });
    function query(predicates: ((row: Row) => boolean)[] = [], order?: string, maximum = Infinity) {
      return {
        where(field: string, op: string, value: unknown) {
          const predicate = (row: Row) => {
            const actual = row[field];
            if (op === "==") return actual === value;
            if (op === "in") return (value as unknown[]).includes(actual);
            if (typeof actual !== "string" || typeof value !== "string") return false;
            if (op === ">=") return actual >= value;
            if (op === "<=") return actual <= value;
            throw new Error(`Unexpected operator ${op}`);
          };
          return query([...predicates, predicate], order, maximum);
        },
        orderBy(field: string) { return query(predicates, field, maximum); },
        limit(value: number) {
          assert.ok(Number.isInteger(value) && value > 0);
          return query(predicates, order, value);
        },
        async get() {
          reads.push(name);
          const matches = rows.filter(([, data]) => predicates.every((predicate) => predicate(data)));
          if (order) matches.sort((a, b) => String(a[1][order]).localeCompare(String(b[1][order])));
          return { docs: matches.slice(0, maximum).map(doc) };
        },
      };
    }
    return {
      ...query(),
      doc(id: string) {
        assert.ok(id && !id.includes("/"));
        return { async get() {
          reads.push(`${name}/${id}`);
          const data = database[name]?.[id];
          return data ? doc([id, data]) : { id, exists: false, data: () => undefined };
        } };
      },
    };
  }
  return { repository: createGraphRepository(() => ({ collection }) as unknown as Firestore), reads };
}

function data(): Database {
  return {
    companies: {
      "1": { id: 1, name: "TSMC", nameLower: "tsmc", ticker: "TSM", tickerLower: "tsm" },
      "2": { id: 2, name: "Apple", nameLower: "apple", ticker: "AAPL", tickerLower: "aapl" },
      "cmp_private": { name: "Private AI", nameLower: "private ai" },
    },
    relationships: {
      "1": { sourceCompanyId: 1, targetCompanyId: 2, type: "customer", confidence: 0.95, source: "manual_seed" },
      "2": { sourceCompanyId: "cmp_private", targetCompanyId: "1", type: "supplier", confidence: 0.8 },
    },
  };
}

test("legacy numeric references and opaque string IDs work together without changing stored data", async () => {
  const database = data();
  const before = structuredClone(database);
  const { repository } = fixture(database);
  const graph = await repository.getGraph("1");
  assert.deepEqual(graph?.nodes.map((node) => node.id), ["1", "2", "cmp_private"]);
  assert.equal(graph?.edges[0].type, "customer");
  assert.equal(graph?.edges[0].sourceNote, "manual_seed");
  assert.equal(graph?.nodes[2].ticker, null);
  assert.deepEqual(database, before);
});

test("document identity wins over a stale stored id, and numeric-looking IDs remain distinct", async () => {
  const database = data();
  database.companies["001"] = { id: 1, name: "Separate company" };
  const { repository } = fixture(database);
  assert.equal((await repository.getCompanyById("001"))?.id, "001");
  assert.equal((await repository.getGraph("001"))?.edges.length, 0);
});

test("lookups trim inputs, support ticker/name, and do not read for invalid paths", async () => {
  const { repository, reads } = fixture(data());
  assert.equal((await repository.getCompanyByIdOrSlug(" aApL "))?.id, "2");
  assert.equal((await repository.getCompanyByIdOrSlug("Private AI"))?.id, "cmp_private");
  const count = reads.length;
  for (const value of ["", " ", "../companies", "x/y"]) {
    assert.equal(await repository.getCompanyByIdOrSlug(value), null);
  }
  assert.equal(reads.length, count);
});

test("ambiguous tickers require a company ID instead of silently joining unrelated companies", async () => {
  const database = data();
  database.companies.other = { name: "Another listing", tickerLower: "aapl" };
  const { repository } = fixture(database);
  await assert.rejects(repository.getCompanyByIdOrSlug("AAPL"), /Ambiguous/);
});

test("search deduplicates name/ticker matches, finds private companies and bounds bad limits", async () => {
  const { repository, reads } = fixture(data());
  assert.deepEqual((await repository.searchCompanies("TS", NaN)).map((company) => company.id), ["1"]);
  assert.equal((await repository.searchCompanies("private", -1))[0].ticker, null);
  const count = reads.length;
  assert.deepEqual(await repository.searchCompanies(" "), []);
  assert.equal(reads.length, count);
});

test("graph enforces actual node limit, includes isolated center and omits dangling edges", async () => {
  const database = data();
  database.relationships.missing = { sourceCompanyId: 1, targetCompanyId: 999, type: "customer", confidence: 1 };
  const { repository } = fixture(database);
  const graph = await repository.getGraph("1", undefined, 2);
  assert.equal(graph?.nodes.length, 2);
  assert.deepEqual(graph?.edges.map((edge) => edge.id), ["rel-1"]);
  const centerOnly = await repository.getGraph("1", undefined, 1);
  assert.equal(centerOnly?.nodes.length, 1);
  assert.deepEqual(centerOnly?.edges, []);
  assert.equal((await repository.getGraph("1", undefined, NaN))?.nodes.length, 3);
  assert.equal(await repository.getGraph("not-found"), null);
});

test("malformed records are excluded and unknown provenance/date is never invented", async () => {
  const database = data();
  database.relationships.bad = { sourceCompanyId: 1, targetCompanyId: 2, type: "customer", confidence: NaN };
  database.companies.broken = { ticker: "BROKEN" };
  const { repository } = fixture(database);
  assert.equal(await repository.getCompanyById("broken"), null);
  const result = await repository.getCompanyWithRelationships("1");
  assert.equal(result?.relationships.length, 2);
  assert.equal(result?.relationships[1].source, null);
  assert.equal(result?.relationships[1].createdAt, null);
});

test("relationship types filter both directions and invalid filters fail explicitly", async () => {
  const { repository } = fixture(data());
  const graph = await repository.getGraph("1", ["supplier"]);
  assert.deepEqual(graph?.nodes.map((node) => node.id), ["1", "cmp_private"]);
  await assert.rejects(repository.getGraph("1", ["SUPPLIER_OF"]), /Unsupported/);
});

test("self relationships are deduplicated when returned by both endpoint queries", async () => {
  const database = data();
  database.relationships.self = { sourceCompanyId: 1, targetCompanyId: 1, type: "competitor", confidence: 0.1 };
  const { repository } = fixture(database);
  assert.equal((await repository.getCompanyWithRelationships("1"))?.relationships.length, 3);
});

test("oversized neighborhoods fail explicitly rather than silently reporting an incomplete graph", async () => {
  const database = data();
  for (let i = 0; i < 201; i++) {
    database.relationships[`extra-${i}`] = { sourceCompanyId: 1, targetCompanyId: 2, type: "customer", confidence: 0.5 };
  }
  const { repository } = fixture(database);
  await assert.rejects(repository.getGraph("1"), /pagination is required/);
});
