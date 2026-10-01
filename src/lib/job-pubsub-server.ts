import { createServer } from "node:http";
import { createMaintenanceLog, maintenanceError, type MaintenanceLog } from "./maintenance-log";

// Cloud Run IAM validates the push identity before this handler. Deploy only as
// a private service; the envelope check is routing validation, not authentication.
export function createJobSubscriber<T extends { batchId: string }>(options: {
  project: string; subscription: string; job: string; parse: (value: unknown) => T;
  additionalSubscriptions?: Array<{ subscription: string; parse: (value: unknown) => T }>;
  process: (request: T, log: MaintenanceLog) => Promise<Record<string, unknown>>;
}) {
  const parsers = new Map<string, (value: unknown) => T>();
  for (const route of [{ subscription: options.subscription, parse: options.parse }, ...options.additionalSubscriptions ?? []]) {
    const name = `projects/${options.project}/subscriptions/${route.subscription}`;
    if (parsers.has(name)) throw Error("Duplicate Pub/Sub subscription route");
    parsers.set(name, route.parse);
  }
  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
    if (req.method !== "POST" || req.url !== "/pubsub") { res.writeHead(404); res.end(); return; }
    const log = createMaintenanceLog(options.job, { mode: "pubsub" });
    let batchId: string | undefined;
    let context: Record<string, unknown> = {};
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64_000) throw Error("Pub/Sub envelope too large");
        chunks.push(Buffer.from(chunk));
      }
      const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const parse = parsers.get(envelope?.subscription);
      if (!parse || typeof envelope?.message?.data !== "string") throw Error("Unexpected Pub/Sub envelope");
      const request = parse(JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")));
      batchId = request.batchId;
      context = { batchId,
        ...("input" in request && request.input && typeof request.input === "object" && "market" in request.input ? { market: request.input.market } : {}),
        ...("companyId" in request ? { company: request.companyId } : {}),
        ...("companyIds" in request && Array.isArray(request.companyIds) ? { requested: request.companyIds.length } : {}) };
      log.emit("INFO", "run_started", context);
      const result = await options.process(request, log);
      const warning = typeof result.status === "string" && !["verified", "ineligible"].includes(result.status);
      log.emit(warning ? "WARNING" : "INFO", "run_completed", { ...context, ...result });
      res.writeHead(204); res.end();
    } catch (error) {
      log.emit("ERROR", "run_failed", { ...context, batchId, error: maintenanceError(error) });
      res.writeHead(503); res.end("Processing requires retry");
    }
  });
}
