import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { replayEarningsFixture } from "../src/lib/earnings/replay";
import { emptyEarningsReplayState, stageEarningsRecord } from "../src/lib/earnings/ledger";

// Deliberately no Firebase, Pub/Sub, provider HTTP, credentials or mutations.
// This command emits JSONL to stdout and never writes a cache, lease or outbox.
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !/^(--dry-run|--manifest=.+|--document=.+|--pdf-text=.+)$/.test(arg))) throw new Error("Usage: --dry-run [--manifest=path --document=raw-file --pdf-text=poppler-layout.txt]");
  if (!args.includes("--dry-run")) throw new Error("Only --dry-run is supported; this pilot cannot activate production collection");
  const arg = (name: string) => args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  const manifest = arg("--manifest"), raw = arg("--document"), pdf = arg("--pdf-text");
  if ((raw || pdf) && !manifest) throw new Error("Raw replay requires an explicit manifest");
  const manifests: string[] = [];
  if (manifest) manifests.push(resolve(manifest));
  else for (const market of ["us", "cn"]) {
    const root = resolve("tests/fixtures/earnings", market);
    for (const file of await readdir(root)) {
      if (!file.endsWith(".json") || /\.plan\.json$/.test(file)) continue;
      const path = resolve(root, file), input = JSON.parse(await readFile(path, "utf8"));
      if (input.source?.companyId && input.bodyFile && input.planFile) manifests.push(path);
    }
  }
  let state = emptyEarningsReplayState(), extracted = 0, reviewRequired = 0;
  for (const path of manifests.sort()) {
    const result = await replayEarningsFixture(path, { rawDocumentPath: raw, pdfTextPath: pdf });
    let staging: string | null = null;
    if (result.outcome.status === "extracted") {
      const staged = stageEarningsRecord(state, result.outcome.record);
      staging = staged.status;
      if (staged.status === "predecessor_missing") reviewRequired++;
      else extracted++;
      state = staged.state;
    } else if (result.outcome.status === "review_required") reviewRequired++;
    console.log(JSON.stringify({ ...result, staging }));
  }
  console.log(JSON.stringify({ type: "earnings.pilot.summary", mode: "dry_run", inputs: manifests.length, extracted, reviewRequired,
    networkRequests: 0, externalWrites: 0, fixtureCoverageOnly: !raw, stagedRevisions: Object.keys(state.records).length }));
  if (reviewRequired || !manifests.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Earnings replay failed"); process.exitCode = 1; });
