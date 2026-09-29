import { loggedTransaction, type MaintenanceLog } from "../maintenance-log";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { record, text } from "./model";
import { validChinaId, MARKET_COMPANIES } from "./china";
import { CANDIDATES } from "./candidates";
import { companyFields } from "../market-companies/model";

export function validateCniDirectory(input: unknown) {
  const payload = record(input), rows = Array.isArray(payload.companies) ? payload.companies.map(record) : [];
  if (!text(payload.source).startsWith("https://www.cnindex.com.cn/zh_information/data_resource/fljg/") || !/^\d{4}-\d{1,2}$/.test(text(payload.snapshot)) || !/^[a-f0-9]{64}$/.test(text(payload.sha256))) throw new Error("Invalid source metadata.");
  if (rows.length < 4000 || new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r => !validChinaId(text(r.id)) || !text(r.name) || !Array.isArray(r.classification) || r.classification.length !== 4 || r.classification.some(c => !text(record(c).code) || !text(record(c).name)))) throw new Error("Invalid directory records.");
  return { payload, rows };
}

export async function importCniDirectory(db: Firestore, input: unknown, log?: MaintenanceLog,
  options: { checkpoint?: DocumentReference; deadline?: number; owner?: string } = {}) {
  const { payload, rows } = validateCniDirectory(input);
  const meta = db.collection("directory_syncs").doc("CN_A_CNI");
  const prior = (await meta.get()).data();
  if (!options.checkpoint && prior?.activeRequest) throw Error("Finish the queued directory import before using direct mode");
  const dateKey = (value: string) => { const [y,m] = value.split("-").map(Number); return y * 12 + m; };
  if (prior?.snapshot && dateKey(text(payload.snapshot)) < dateKey(prior.snapshot)) throw new Error("Refusing an older snapshot.");
  if (prior?.sha256 === payload.sha256) return { unchanged: true, count: rows.length };
  const now = new Date().toISOString();
  // Bounded transactions; a partial import is safe to replay. Only mark the snapshot complete at the end.
  const start = options.checkpoint ? Number((await options.checkpoint.get()).get("offset") ?? 0) : 0;
  if (!Number.isInteger(start) || start < 0 || start > rows.length || (start !== rows.length && start % 100)) throw Error("Invalid directory checkpoint");
  for (let offset = start; offset < rows.length; offset += 100) {
    if (Date.now() >= (options.deadline ?? Infinity) - 60_000) throw Error("Directory import incomplete; retry remaining records");
    const group = rows.slice(offset, offset + 100);
    const writeBatch = async (tx: FirebaseFirestore.Transaction) => {
      if (options.owner) {
        const lease = (await tx.get(meta)).data();
        if (lease?.leaseOwner !== options.owner || Number(lease.leaseExpiresAtMs) <= Date.now()) throw Error("Directory lease expired");
      }
      if (options.checkpoint && Number((await tx.get(options.checkpoint)).get("offset") ?? 0) !== offset) throw Error("Directory progress changed");
      const refs = group.map(r => db.collection(CANDIDATES).doc(text(r.id)));
      const existing = await tx.getAll(...refs);
      const profiles = await tx.getAll(...group.map(r => db.collection(MARKET_COMPANIES).doc(text(r.id))));
      group.forEach((r, i) => {
        const classification = (r.classification as unknown[]).map(record);
        tx.set(db.collection("company_directory").doc(text(r.id)), { ...r, market: "CN_A", taxonomy: "CNI", snapshot: payload.snapshot, source: payload.source, updatedAt: now }, { merge: true });
        const profile = profiles[i].data() ?? {};
        tx.set(db.collection(MARKET_COMPANIES).doc(text(r.id)), {
          ...companyFields(text(r.id), {...r, ...profile}), classification, taxonomy:"CNI",
          status:profile.status ?? "DIRECTORY",
          ...(!profile.source ? {source:payload.source,sourceLabel:`国证行业分类 ${payload.snapshot}`} : {}), updatedAt:now,
        }, {merge:true});
        tx.set(refs[i], {
          ...(!existing[i].exists ? { id: r.id, name: r.name, industry: `国证行业：${classification.map(c => c.name).join(" / ")}`, status: profiles[i].data()?.status === "PUBLISHED" ? "PUBLISHED" : "PENDING", attempts: 0, createdAt: now } : {}),
          classification, taxonomy: "CNI", snapshot: payload.snapshot, source: payload.source, sourceLabel: `国证行业分类 ${payload.snapshot}`, updatedAt: now,
        }, { merge: true });
      });
      if (options.checkpoint) tx.set(options.checkpoint, { offset: offset + group.length }, { merge: true });
    };
    if (log) await loggedTransaction(db, log, { batchOffset: offset, batchSize: group.length }, writeBatch);
    else await db.runTransaction(writeBatch);
  }
  const industries = [...new Map(rows.map(r => { const c = (r.classification as { code: string; name: string }[])[2]; return [c.code, c]; })).values()].sort((a,b) => a.code.localeCompare(b.code));
  await meta.set({ industries, source: payload.source, snapshot: payload.snapshot, sha256: payload.sha256, count: rows.length, completedAt: now }, { merge: true });
  return { unchanged: false, count: rows.length };
}
