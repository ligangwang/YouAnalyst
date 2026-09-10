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
    `--query-scope=${index.queryScope}`,
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
  if (indexes.length === 0) {
    console.log("No composite indexes defined. Skipping.");
    return;
  }

  console.log(`Applying ${indexes.length} Firestore composite index(es) to ${projectId}...`);
  for (const index of indexes) {
    applyIndex(projectId, index);
  }

  console.log("Firestore index apply complete.");
}

try {
  main();
} catch (error) {
  console.error("Failed to apply Firestore indexes:", error);
  process.exitCode = 1;
}
