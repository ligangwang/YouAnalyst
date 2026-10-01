export function parseCompanyGraphPublisherArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  let apply = false, dryRun = false, verifyLive = false, verify = env.COMPANY_GRAPH_VERIFY_ONLY === "1";
  let limit: number | undefined;
  const seen = new Set<string>();
  for (const arg of args) {
    const key = arg.split("=")[0];
    if (seen.has(key)) throw new Error(`Duplicate argument: ${key}`);
    seen.add(key);
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--verify-delivery") verify = true;
    else if (arg === "--verify-live") verifyLive = true;
    else if (/^--limit=[1-5]$/.test(arg)) limit = Number(arg.split("=")[1]);
    else throw new Error(`Unsupported argument: ${arg}. Use --apply, --dry-run, --limit=1..5, --verify-delivery, or --verify-live.`);
  }
  if ((apply && dryRun) || (verify && (apply || dryRun || verifyLive || limit !== undefined))
    || (verifyLive && (apply || dryRun || limit !== undefined))) throw new Error("Conflicting graph publisher modes/options");
  const configured = env.COMPANY_GRAPH_QUEUE_BATCH_SIZE;
  if (limit === undefined && configured && !/^[1-5]$/.test(configured)) throw new Error("COMPANY_GRAPH_QUEUE_BATCH_SIZE must be 1..5");
  return { preview: !apply, verify, ...(verifyLive ? { verifyLive: true } : {}), limit: limit ?? Number(configured || 1) };
}
