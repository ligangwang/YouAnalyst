export function parseSecCollectorArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  let apply = false, dryRun = false, baselineOnly = false, companyId: string | undefined;
  const seen = new Set<string>();
  for (const arg of args) {
    const key = arg.split("=")[0];
    if (seen.has(key)) throw new Error(`Duplicate argument: ${key}`);
    seen.add(key);
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--baseline-only") baselineOnly = true;
    else if (/^--company=[A-Z0-9][A-Z0-9.-]{0,15}$/.test(arg)) companyId = arg.slice("--company=".length);
    else throw new Error(`Unsupported SEC collector argument: ${arg}`);
  }
  if (apply && dryRun) throw new Error("Cannot combine --apply and --dry-run");
  if (baselineOnly !== Boolean(companyId)) throw new Error("--baseline-only and --company=TICKER must be used together");
  const maxCompanies = Number(env.SEC_FILINGS_MAX_COMPANIES ?? "500");
  if (!Number.isSafeInteger(maxCompanies) || maxCompanies < 1 || maxCompanies > 500) {
    throw new Error("SEC_FILINGS_MAX_COMPANIES must be an integer from 1 to 500");
  }
  return { apply, companyId, baselineOnly, maxCompanies: baselineOnly ? 1 : maxCompanies };
}
