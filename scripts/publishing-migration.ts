import { mkdirSync, writeFileSync } from "node:fs";
import { planPublishingMigration } from "../src/lib/predictions/publishing-migration";

const root = "https://firestore.googleapis.com/v1/projects/ifindata-80905/databases/(default)/documents";
const headers = { authorization: `Bearer ${process.env.MIGRATION_TOKEN}`, "content-type": "application/json" };
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(root + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`Firestore HTTP ${response.status}`);
  return response.json();
}
type Value = { stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number; nullValue?: null; mapValue?: { fields: Record<string, Value> }; arrayValue?: { values?: Value[] } };
function decode(value: Value): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields).map(([key, v]) => [key, decode(v)]));
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  return null;
}
async function readCollection(collection: string) {
  const rows = [];
  let pageToken: string | undefined;
  do {
    const result = await request(`/${collection}?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    for (const doc of result.documents ?? []) rows.push({ id: doc.name.split("/").pop(), ...Object.fromEntries(Object.entries(doc.fields as Record<string, Value>).map(([key, value]) => [key, decode(value)])), _updateTime: doc.updateTime });
    pageToken = result.nextPageToken;
  } while (pageToken);
  return rows;
}
async function main() {
  if (!process.env.MIGRATION_TOKEN) throw new Error("Supply a short-lived MIGRATION_TOKEN; never save it to disk.");
  const owners = await readCollection("users");
  const snapshot = { watchlists: await readCollection("watchlists"), predictions: await readCollection("predictions") };
  mkdirSync("output", { recursive: true });
  writeFileSync("output/publishing-snapshot.json", JSON.stringify(snapshot, null, 2));
  // Snapshot types are checked by the planner; this tool is only for the known legacy schema.
  const groups = snapshot.watchlists as unknown as Parameters<typeof planPublishingMigration>[0];
  const predictions = snapshot.predictions as unknown as Parameters<typeof planPublishingMigration>[1];
  const candidates = groups.filter(group => group.name === "NVDA vs AMD" && !group.archivedAt);
  if (candidates.length !== 1) throw new Error("Expected exactly one confirmed NVDA vs AMD comparison");
  const selected = process.argv.filter(arg => arg.startsWith("--primary=")).map(arg => arg.slice("--primary=".length));
  const plan = planPublishingMigration(groups, predictions, candidates[0].id, selected);
  writeFileSync("output/publishing-plan.json", JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ ready: plan.ready, groups: groups.length, predictions: predictions.length, archiveGroups: plan.archiveGroupIds.length, conflicts: plan.conflicts.map(c => ({ ticker: c.ticker, count: c.predictionIds.length })), issues: plan.issues.length }));
  const groupsOnly = process.argv.includes("--apply-groups");
  if (!process.argv.includes("--apply") && !groupsOnly) return;
  if (!plan.groupsReady || (!groupsOnly && !plan.ready)) throw new Error("Migration is blocked; inspect the private dry-run report.");
  if (groupsOnly && selected.length) throw new Error("Group-only migration cannot select a primary prediction");
  const now = new Date().toISOString();
  const writes: unknown[] = snapshot.watchlists.filter(group => group.id === plan.comparison.id || plan.archiveGroupIds.includes(group.id)).map(group => ({
    update: { name: `${root.replace("https://firestore.googleapis.com/v1/", "")}/watchlists/${group.id}`, fields: group.id === plan.comparison.id
      ? { kind: { stringValue: "COMPARISON" }, predictionIds: { arrayValue: { values: plan.comparison.predictionIds.map(id => ({ stringValue: id })) } }, updatedAt: { stringValue: now } }
      : { kind: { stringValue: "LEGACY" }, archivedAt: { stringValue: now }, updatedAt: { stringValue: now } } },
    updateMask: { fieldPaths: group.id === plan.comparison.id ? ["kind", "predictionIds", "updatedAt"] : ["kind", "archivedAt", "updatedAt"] },
    currentDocument: { updateTime: group._updateTime },
  }));
  for (const userId of new Set(groups.map(group => group.userId))) {
    const owner = owners.find(owner => owner.id === userId);
    if (!owner) throw new Error("Group owner is missing");
    const selections = plan.primarySelections.filter(selection => selection.userId === userId);
    writes.push({ update: {
      name: `${root.replace("https://firestore.googleapis.com/v1/", "")}/users/${userId}`,
      fields: { updatedAt: { stringValue: now }, ...(selections.length ? { publishingPrimaryPredictions: { mapValue: { fields: Object.fromEntries(selections.map(selection => [selection.ticker, { stringValue: selection.predictionId }])) } } } : {}) },
    }, updateMask: { fieldPaths: ["updatedAt", ...selections.map(selection => `publishingPrimaryPredictions.${selection.ticker}`)] }, currentDocument: { updateTime: owner._updateTime } });
  }
  // The snapshot and checked plan are saved before any mutation. No prediction is rewritten.
  await request(":commit", "POST", { writes });
  console.log("Migration applied; prediction records unchanged.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
