import assert from "node:assert/strict";
import { Storage, type Bucket, type File } from "@google-cloud/storage";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore, type DocumentData } from "firebase-admin/firestore";
import { encode, decode } from "../src/lib/central-cache/codec";
import { workerObjectName, type WorkerKind } from "../src/lib/fundamentals/worker-control";

const kinds = ["sec", "cn"] as const;
const prefix = "worker-state/v1/fundamentals/";
const fencePrefix = "fundamentals-gcs-handoff/";
const receiptName = prefix + "handoff.json";

async function createVerified(file: File, bytes: Buffer) {
  try {
    await file.save(bytes, {resumable:false, metadata:{contentType:"application/json"}, preconditionOpts:{ifGenerationMatch:0}});
  } catch (error) {
    if (Number((error as {code?:number}).code) !== 412) throw error;
  }
  const [metadata] = await file.getMetadata();
  const generation = String(metadata.generation);
  const [stored] = await file.bucket.file(file.name, {generation}).download();
  assert(stored.equals(bytes), "Existing handoff object differs: " + file.name);
  return generation;
}

// Call only for the one-time operator cutover. A failed run can resume from the
// immutable originals named in both fences. Existing workers observe a busy
// lease until their old revisions have drained and the source is retired.
export async function handoffWorkerControls(db: Firestore, bucket: Bucket) {
  const receipt = bucket.file(receiptName);
  if ((await receipt.exists())[0]) throw Error("Worker handoff already published");
  const controls = [];
  const batch = db.batch();
  for (const kind of kinds) {
    const id = kind === "sec" ? "_worker" : "_cn_worker";
    const base = "company_fundamentals";
    const ref = db.doc("market_ugc/" + base + "/records/" + id);
    const [source, root, state] = await db.getAll(ref, db.doc(base + "/" + id), db.doc("market_state/" + base + "/records/" + id));
    assert(source.exists && !root.exists && !state.exists, "Unexpected worker control placement");
    const data = source.data()!;
    let key: string;
    if (typeof data.leaseOwner === "string" && data.leaseOwner.startsWith(fencePrefix)) {
      key = data.leaseOwner.slice(fencePrefix.length);
      assert(/^\d+-\d+$/.test(key) && data.leaseExpiresAtMs === Number.MAX_SAFE_INTEGER && !data.leaseTask);
    } else {
      assert(!(data.leaseExpiresAtMs > Date.now()) && !(data.manualDispatchUntil > Date.now()), "A worker or manual reservation is active");
      key = source.updateTime!.seconds + "-" + source.updateTime!.nanoseconds;
      await createVerified(bucket.file(prefix + "handoffs/" + kind + "/" + key + ".json"), Buffer.from(JSON.stringify(encode(data))));
      batch.update(ref, {leaseOwner:fencePrefix + key, leaseExpiresAtMs:Number.MAX_SAFE_INTEGER, leaseTask:FieldValue.delete()}, {lastUpdateTime:source.updateTime!});
    }
    controls.push({kind, ref, key});
  }
  await batch.commit();
  const generations: Partial<Record<WorkerKind,string>> = {};
  for (const {kind, ref, key} of controls) {
    const locked = await ref.get();
    assert.equal(locked.get("leaseOwner"), fencePrefix + key);
    const [bytes] = await bucket.file(prefix + "handoffs/" + kind + "/" + key + ".json").download();
    const old = decode(JSON.parse(bytes.toString()));
    const expected: DocumentData = {...old, leaseOwner:fencePrefix + key, leaseExpiresAtMs:Number.MAX_SAFE_INTEGER};
    delete expected.leaseTask;
    assert.deepEqual(locked.data(), expected, "Control changed during handoff");
    generations[kind] = await createVerified(bucket.file(workerObjectName(kind)), bytes);
  }
  await createVerified(receipt, Buffer.from(JSON.stringify({version:1, bucket:bucket.name, generations})));
}

if (require.main === module) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const name = process.env.ENTITY_SNAPSHOT_BUCKET || process.env.EODHD_BULK_EOD_BUCKET;
  assert(project && name && !process.env.FIRESTORE_EMULATOR_HOST && process.argv[2] === "--apply");
  initializeApp({projectId:project, credential:applicationDefault()});
  const db = getFirestore();
  handoffWorkerControls(db, new Storage({projectId:project}).bucket(name)).finally(() => db.terminate())
    .catch(error => {console.error(error);process.exitCode=1;});
}
