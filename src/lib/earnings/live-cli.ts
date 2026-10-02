export type EarningsCliMode = "dry-run" | "diagnostics" | "verify-delivery" | "check-canary" | "collect" | "canary" | "replay-alibaba-march-2026";
export function parseEarningsCollectorArgs(args: string[]): EarningsCliMode {
  if (new Set(args).size !== args.length) throw new Error("Duplicate earnings CLI option");
  if (!args.length || (args.length === 1 && args[0] === "--dry-run")) return "dry-run";
  for (const mode of ["diagnostics", "verify-delivery", "check-canary"] as const) if (args.length === 1 && args[0] === `--${mode}`) return mode;
  if (args.length === 1 && args[0] === "--apply") return "collect";
  if (args.length === 2 && args.includes("--apply") && args.includes("--canary")) return "canary";
  if (args.length === 2 && args.includes("--apply") && args.includes("--replay-alibaba-march-2026")) return "replay-alibaba-march-2026";
  throw new Error("Use --dry-run, --diagnostics, --verify-delivery, --check-canary, --apply, --apply --canary, or --apply --replay-alibaba-march-2026");
}
