import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { captureEarningsDocument } from "./document";
import { extractEarnings, type ExtractionPlan } from "./extract";
import { type EarningsSource, type RawEarningsDocument, sha256 } from "./model";

export type EarningsReplayInput = { id: string; source: EarningsSource; bodyFile: string; mediaType: RawEarningsDocument["mediaType"];
  planFile: string; rawPlanFile?: string; completeness?: "full" | "excerpt"; originalBytesSha256?: string | null };
export async function replayEarningsFixture(manifestPath: string, options: {
  now?: string; rawDocumentPath?: string; pdfTextPath?: string;
} = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as EarningsReplayInput;
  if (!manifest.id || !manifest.source || !manifest.bodyFile || !manifest.planFile) throw new Error("Invalid earnings replay manifest");
  const root = dirname(manifestPath), raw = Boolean(options.rawDocumentPath);
  const planFile = raw ? manifest.rawPlanFile : manifest.planFile;
  if (!planFile) throw new Error("No reviewed raw-document extraction adapter for this source");
  if (raw && (typeof manifest.originalBytesSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.originalBytesSha256))) throw new Error("Raw replay requires a valid reference SHA-256 hash");
  const plan = JSON.parse(await readFile(resolve(root, planFile), "utf8")) as ExtractionPlan;
  const bytes = await readFile(options.rawDocumentPath ?? resolve(root, manifest.bodyFile));
  if (raw && sha256(bytes) !== manifest.originalBytesSha256) throw new Error("Raw source hash changed; review the adapter before replay");
  const now = options.now ?? new Date().toISOString();
  let pdfText: string | undefined;
  if (raw && options.rawDocumentPath?.toLowerCase().endsWith(".pdf")) {
    const result = await promisify(execFile)("pdftotext", ["-layout", resolve(options.rawDocumentPath), "-"], { timeout: 20_000, maxBuffer: 20 * 1024 * 1024 });
    pdfText = result.stdout;
    if (options.pdfTextPath && (await readFile(options.pdfTextPath, "utf8")).trim() !== pdfText.trim()) throw new Error("Supplied PDF text does not match fresh Poppler extraction");
  }
  const document = captureEarningsDocument(manifest.source, bytes, { mediaType: raw && options.rawDocumentPath?.toLowerCase().endsWith(".pdf") ? "application/pdf" : manifest.mediaType,
    retrievedAt: now, completeness: raw ? "full" : "excerpt", pdfText });
  return { id: manifest.id, capture: { rawSha256: document.rawSha256, textSha256: document.textSha256, completeness: document.completeness, textMethod: document.textMethod },
    outcome: extractEarnings(document, plan, now) };
}
