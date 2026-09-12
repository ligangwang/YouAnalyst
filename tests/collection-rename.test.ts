import test from "node:test";
import assert from "node:assert/strict";
import { Firestore, Timestamp, GeoPoint, FieldValue } from "@google-cloud/firestore";
import { assertIdentical, encode, fingerprint, protectCompanies } from "../scripts/firestore/exact-copy";
import { Root } from "protobufjs";
import schema from "@google-cloud/firestore/build/protos/v1.json";

test("raw protobuf copies preserve int64 extremes and whole-valued doubles", () => {
  const fields = {
    big: { integerValue: "9223372036854775807" },
    small: { integerValue: "-9223372036854775808" },
    wholeDouble: { doubleValue: 42 },
    negativeZero: { doubleValue: -0 },
    at: { timestampValue: { seconds: "123", nanos: 456 } },
  };
  const Document = Root.fromJSON(schema).lookupType("google.firestore.v1.Document");
  const bytes = Document.encode(Document.fromObject({ fields })).finish();
  const copy = Document.toObject(Document.decode(bytes), { longs: String }).fields;
  assertIdentical(fields, copy, "companies/US:TEST");
  assert.equal(copy.big.integerValue, "9223372036854775807");
  assert.equal(copy.wholeDouble.doubleValue, 42);
  assert.equal(copy.wholeDouble.integerValue, undefined);
  assert(Object.is(copy.negativeZero.doubleValue, -0));
  assert.throws(() => assertIdentical(fields, { ...fields, wholeDouble: { integerValue: "42" } }, "changed type"));
});

test("exact-copy checks nested fields, nanosecond timestamps, and array order", () => {
  const data = { at: new Timestamp(123, 456), nested: { n: 1 }, array: [1, 2] };
  assertIdentical(data, { array: [1, 2], nested: { n: 1 }, at: new Timestamp(123, 456) }, "companies/US:NVDA");
  for (const changed of [{ ...data, at: new Timestamp(123, 457) }, { ...data, extra: true }, { ...data, array: [2, 1] }]) {
    assert.throws(() => assertIdentical(data, changed, "companies/US:NVDA"), /Conflicting destination/);
  }
});

test("recovery encoding preserves Firestore types and qualified references", () => {
  const db = new Firestore({ projectId: "test-project", databaseId: "test-db" });
  assert.deepEqual(encode(db.doc("market_companies/US:NVDA")), ["reference", "projects/test-project/databases/test-db/documents/market_companies/US:NVDA"]);
  assert.deepEqual(encode(new GeoPoint(10, 20)), ["geopoint", 10, 20]);
  assert.deepEqual(encode(Buffer.from([1, 2])), ["bytes", "AQI="]);
  assert.deepEqual(encode(FieldValue.vector([1, 2])), ["vector", [1, 2]]);
  assert.notEqual(fingerprint(NaN), fingerprint(null));
  assert.notEqual(fingerprint(-0), fingerprint(0));
  assert.notEqual(fingerprint(Infinity), fingerprint("Infinity"));
  assert.throws(() => encode(new Date()), /Unsupported Firestore value/);
});

test("rule patch is narrow, replay-safe, and rejects unfamiliar permissions", () => {
  const original = "unrelated\nmatch /companies/{companyId} { allow read: if isSignedIn(); allow write: if false; }\nunchanged";
  const patched = protectCompanies(original);
  assert.equal(patched, "unrelated\nmatch /companies/{companyId} {\n      allow read, write: if false;\n    }\nunchanged");
  assert.equal(protectCompanies(patched), patched);
  assert.throws(() => protectCompanies(original.replace("isSignedIn()", "true")), /differs from expected/);
  assert.throws(() => protectCompanies(original + original), /differs from expected/);
});
