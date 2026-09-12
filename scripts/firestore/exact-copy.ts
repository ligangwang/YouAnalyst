import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import { VectorValue } from "@google-cloud/firestore";

// Tagged tuples avoid confusing user fields with type markers in recovery exports.
export function encode(value: unknown): unknown {
  if (value === null) return ["null"];
  if (value instanceof Timestamp) return ["timestamp", value.seconds, value.nanoseconds];
  if (value instanceof GeoPoint) return ["geopoint", value.latitude, value.longitude];
  if (value instanceof DocumentReference) {
    // The SDK exposes the qualified name at runtime (including project/database).
    const name = (value as DocumentReference & { formattedName: string }).formattedName;
    assert(typeof name === "string" && name.startsWith("projects/"), "Missing qualified reference name");
    return ["reference", name];
  }
  if (value instanceof VectorValue) return ["vector", value.toArray()];
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return ["bytes", Buffer.from(value).toString("base64")];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value === "boolean" || typeof value === "string") return [typeof value, value];
  assert(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "Unsupported Firestore value; refusing a lossy copy");
  return ["map", Object.keys(value).sort().map(key => [key, encode((value as Record<string, unknown>)[key])])];
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(encode(value))).digest("hex");
}

export function assertIdentical(source: unknown, destination: unknown, path: string) {
  assert.equal(fingerprint(source), fingerprint(destination), `Conflicting destination: ${path}; no overwrite allowed`);
}

export function protectCompanies(source: string): string {
  if (/match \/companies\/\{companyId\} \{\s*allow read, write: if false;\s*\}/.test(source)) return source;
  const rule = /match \/companies\/\{companyId\} \{\s*allow read: if (?:isSignedIn\(\)|false);\s*allow write: if false;\s*\}/g;
  const matches = [...source.matchAll(rule)];
  assert.equal(matches.length, 1, "Live companies rule differs from expected; inspect before copying data");
  return source.replace(rule, "match /companies/{companyId} {\n      allow read, write: if false;\n    }");
}
