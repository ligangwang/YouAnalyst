import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { companyFields } from "./model";

export class CompanyNameError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function parseNameEdit(value: unknown) {
  const body = value as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["companyId", "locale", "name", "expectedName"].includes(key)) ||
      typeof body.companyId !== "string" || !/^(US:[A-Z0-9.-]{1,30}|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9][A-Z0-9.-]{0,79})$/.test(body.companyId) ||
      !["en", "zh-CN"].includes(String(body.locale)) ||
      typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 || /[\p{Cc}\p{Cf}<>]/u.test(body.name) ||
      typeof body.expectedName !== "string" || body.expectedName.length > 200) {
    throw new CompanyNameError(400, "Invalid company display name edit");
  }
  return { companyId: body.companyId, locale: body.locale as "en" | "zh-CN", name: body.name.trim(), expectedName: body.expectedName };
}

export async function editCompanyName(db: Firestore, input: unknown, uid: string) {
  const edit = parseNameEdit(input);
  return db.runTransaction(async tx => {
    const ref = db.collection("companies").doc(edit.companyId);
    const snapshot = await tx.get(ref);
    const old = snapshot.data();
    if (!old || !["PUBLISHED", "DIRECTORY"].includes(old.status)) throw new CompanyNameError(404, "Company not found");
    const previous = old.names?.[edit.locale] ?? "";
    if (previous !== edit.expectedName) throw new CompanyNameError(409, "Name changed; reload before editing");
    const names = { ...old.names, [edit.locale]: edit.name };
    const aliases = [...new Set([...(Array.isArray(old.aliases) ? old.aliases.filter((v: unknown) => typeof v === "string") : []), ...(previous && previous !== edit.name ? [previous] : [])])];
    if (previous !== edit.name) {
      tx.update(ref, {
        names, aliases, searchPrefixes: companyFields(edit.companyId, { ...old, names, aliases }).searchPrefixes,
        [`nameEdits.${edit.locale}`]: { previousName: previous, name: edit.name, editedBy: uid, editedAt: new Date().toISOString() },
      });
      // Existing metadata collection: invalidate graph caches across Cloud Run instances.
      tx.set(db.collection("directory_syncs").doc("company_names"), { revision: randomUUID() }, { merge: true });
    }
    return { companyId: edit.companyId, names, aliases };
  });
}
