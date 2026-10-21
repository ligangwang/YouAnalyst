import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

type IndexField = {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
};

type CompositeIndex = {
  collectionGroup: string;
  queryScope: "COLLECTION" | "COLLECTION_GROUP";
  fields: IndexField[];
};

type FirestoreIndexesFile = {
  indexes: CompositeIndex[];
  fieldOverrides?: {collectionGroup:string;fieldPath:string;indexes:(Partial<IndexField>&{queryScope?:string})[]}[];
};

function runCommand(command: string, args: string[]): { code: number; output: string } {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function normalizeOrder(order: "ASCENDING" | "DESCENDING"): "ascending" | "descending" {
  return order === "ASCENDING" ? "ascending" : "descending";
}

function buildFieldConfig(field: IndexField): string {
  if (field.order) {
    return `field-path=${field.fieldPath},order=${normalizeOrder(field.order)}`;
  }

  if (field.arrayConfig === "CONTAINS") {
    return `field-path=${field.fieldPath},array-config=contains`;
  }

  throw new Error(`Unsupported index field config for ${field.fieldPath}`);
}

function describeIndex(index: CompositeIndex): string {
  const fields = index.fields
    .map((field) => {
      if (field.order) {
        return `${field.fieldPath} ${field.order.toLowerCase()}`;
      }
      if (field.arrayConfig) {
        return `${field.fieldPath} ${field.arrayConfig.toLowerCase()}`;
      }
      return field.fieldPath;
    })
    .join(", ");

  return `${index.collectionGroup} [${fields}]`;
}

function applyIndex(projectId: string, index: CompositeIndex): void {
  const args = [
    "firestore",
    "indexes",
    "composite",
    "create",
    `--project=${projectId}`,
    `--collection-group=${index.collectionGroup}`,
    `--query-scope=${index.queryScope.toLowerCase().replaceAll("_", "-")}`,
    "--async",
  ];

  for (const field of index.fields) {
    args.push(`--field-config=${buildFieldConfig(field)}`);
  }

  const result = runCommand("gcloud", args);
  if (result.code === 0) {
    console.log(`Submitted index creation: ${describeIndex(index)}`);
    return;
  }

  if (/ALREADY_EXISTS|already exists/i.test(result.output)) {
    console.log(`Index already exists: ${describeIndex(index)}`);
    return;
  }

  throw new Error(result.output.trim() || `Failed to create index for ${describeIndex(index)}`);
}

function main() {
  const projectId = process.env.FIRESTORE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("FIRESTORE_PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set");
  }

  const filePath = resolve(process.cwd(), "firestore.indexes.json");
  const fileData = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(fileData) as FirestoreIndexesFile;

  const groups = process.env.FIRESTORE_COLLECTION_GROUPS?.split(",").map(value => value.trim()).filter(Boolean);
  const indexes = (parsed.indexes ?? []).filter(index => !groups?.length || groups.includes(index.collectionGroup));
  console.log(`Applying ${indexes.length} Firestore composite index(es) to ${projectId}...`);
  for (const index of indexes) applyIndex(projectId, index);
  const overrides = (parsed.fieldOverrides ?? []).filter(field => !groups?.length || groups.includes(field.collectionGroup));
  // Retired search indexes must remain available until the web and workers switch readers.
  if (overrides.some(field=>!field.indexes.length) && process.env.FIRESTORE_APPLY_FIELD_OVERRIDES !== '1') console.log('Deferred field exemptions: apply explicitly after company search rollout and cleanup.');
  for (const field of overrides) {
    if(!field.indexes.length && process.env.FIRESTORE_APPLY_FIELD_OVERRIDES !== '1')continue;
    const configs=field.indexes.map(index=>{
      if(!index.order||index.queryScope!=='COLLECTION')throw Error('Unsupported single-field index');
      return `--index=order=${normalizeOrder(index.order)}`;
    });
    const result = runCommand('gcloud', ['firestore','indexes','fields','update',field.fieldPath,`--project=${projectId}`,`--collection-group=${field.collectionGroup}`,...(configs.length?configs:['--disable-indexes']),'--quiet']);
    if (result.code !== 0) throw new Error(result.output.trim() || 'Field index exemption failed');
    console.log(`${configs.length?'Configured':'Disabled'} single-field indexes: ${field.collectionGroup}.${field.fieldPath}`);
  }
  console.log("Firestore index apply complete.");
}

try {
  main();
} catch (error) {
  console.error("Failed to apply Firestore indexes:", error);
  process.exitCode = 1;
}
