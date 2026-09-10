import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { filingEvent, type FilingEventInput } from "./model";

function string(value: unknown): string { return typeof value === "string" ? value : ""; }

export function historicalFilingInput(data: Record<string, unknown>, type: FilingEventInput["type"], filing?: Record<string, unknown>): FilingEventInput | null {
  if (type === "SEC_13F" && data.holdingsComplete !== true) return null;
  if (type === "SEC_FORM4" && filing?.status !== "PARSED") return null;
  const source = type === "SEC_FORM4" ? filing! : data;
  const input: FilingEventInput = {
    type, accessionNumber: string(data.accessionNumber), filingDate: string(source.filingDate),
    sourceUrl: string(type === "SEC_FORM4" ? source.filingUrl : data.infoTableUrl),
    entityName: string(type === "SEC_FORM4" ? data.issuerName : data.managerName),
    tickers: type === "SEC_FORM4" && string(data.ticker) ? [string(data.ticker)] : [],
    amended: source.form === "4/A" || source.form === "13F-HR/A",
  };
  try { filingEvent(input, new Date().toISOString()); return input; } catch { return null; }
}

/** Seed an empty stream from bounded, already-processed public records. */
export async function bootstrapPublicEvents(db: Firestore = getAdminFirestore()) {
  if (!(await db.collection("events").limit(1).get()).empty) return { created: 0, alreadyPopulated: true };
  const [transactions, institutions] = await Promise.all([
    db.collection("insider_transactions").orderBy("filingDate", "desc").limit(150).get(),
    db.collection("institutional_13f_canonical_filings").orderBy("filingDate", "desc").limit(30).get(),
  ]);
  const unique = new Map<string, Record<string, unknown>>();
  for (const doc of transactions.docs) {
    const data = doc.data();
    const accession = string(data.accessionNumber);
    if (/^\d{10}-\d{2}-\d{6}$/.test(accession) && unique.size < 30) unique.set(accession, data);
  }
  const refs = [...unique.keys()].map(id => db.collection("sec_insider_filings").doc(id));
  const filings = refs.length ? await db.getAll(...refs) : [];
  const inputs = [
    ...filings.map(doc => historicalFilingInput(unique.get(doc.id)!, "SEC_FORM4", doc.data())),
    ...institutions.docs.map(doc => historicalFilingInput(doc.data(), "SEC_13F")),
  ].filter((item): item is FilingEventInput => item !== null);
  let created = 0;
  // Create-only writes preserve any event concurrently published by ingestion.
  for (const input of inputs.sort((a, b) => a.filingDate.localeCompare(b.filingDate))) {
    const event = filingEvent(input, new Date().toISOString());
    try { await db.collection("events").doc(event.id).create(event); created++; }
    catch (error) { if ((error as { code?: number }).code !== 6) throw error; }
  }
  return { created, alreadyPopulated: false };
}
