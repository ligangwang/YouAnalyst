#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const job = "refresh-company-graph-production";
const limit = 5;
const fail = () => { throw new Error("Invalid execution diagnostics"); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function count(value = 0, maximum = 10_000) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) fail();
  return value;
}

function timestamp(value, required = false) {
  if (value === undefined && !required) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) fail();
  return value;
}

function graphArgs(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > 4 || args[0] !== "dist/refresh-company-graph.cjs") fail();
  const modes = new Set(["--apply", "--dry-run", "--verify-delivery", "--verify-live"]);
  let mode, hasLimit = false;
  for (const arg of args.slice(1)) {
    if (modes.has(arg)) {
      if (mode) fail();
      mode = arg;
    } else if (typeof arg === "string" && /^--limit=[1-5]$/.test(arg)) {
      if (hasLimit) fail();
      hasLimit = true;
    } else fail();
  }
  if (hasLimit && (mode === "--verify-delivery" || mode === "--verify-live")) fail();
  return args;
}

function projectExecution(value, project, region) {
  if (!object(value) || (value.apiVersion !== undefined && value.apiVersion !== "run.googleapis.com/v1")
    || (value.kind !== undefined && value.kind !== "Execution")) fail();
  const { metadata, spec, status } = value;
  if (!object(metadata) || typeof metadata.name !== "string"
    || !/^refresh-company-graph-production-[a-z0-9]{1,30}$/.test(metadata.name)
    || metadata.labels?.["run.googleapis.com/job"] !== job
    || metadata.labels?.["cloud.googleapis.com/location"] !== region
    || !object(spec) || !object(status)) fail();
  // The API normally uses the project number as namespace; the gcloud --project
  // scope selects it. Reject a conflicting project ID if the API returns an ID.
  if (metadata.namespace !== undefined && metadata.namespace !== project
    && !(typeof metadata.namespace === "string" && /^\d{1,20}$/.test(metadata.namespace))) fail();
  const task = spec.template?.spec;
  if (!object(task) || !Array.isArray(task.containers) || task.containers.length !== 1) fail();
  const container = task.containers[0];
  if (!object(container) || !Array.isArray(container.command) || container.command.length !== 1
    || container.command[0] !== "node") fail();
  const repository = `${region}-docker.pkg.dev/${project}/ifindata/sec-fundamentals@`;
  if (typeof container.image !== "string" || !container.image.startsWith(repository)) fail();
  const imageDigest = container.image.slice(repository.length);
  if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest)) fail();

  const conditions = status.conditions === undefined ? [] : status.conditions;
  if (!Array.isArray(conditions) || conditions.length > 10) fail();
  const allowedConditions = new Set(["ResourcesAvailable", "Started", "Completed", "ContainerReady"]);
  const allowedReasons = new Set(["NonZeroExitCode", "DeadlineExceeded", "ProgressDeadlineExceeded",
    "Cancelled", "Cancelling", "Deleted", "JobStatusServicePollingError", "ContainerMissing",
    "ContainerPermissionDenied", "SecretsAccessCheckFailed"]);
  const seen = new Set();
  const projectedConditions = [];
  for (const condition of conditions) {
    if (!object(condition) || typeof condition.type !== "string") fail();
    if (!allowedConditions.has(condition.type)) continue;
    if (seen.has(condition.type) || !["True", "False", "Unknown"].includes(condition.status)) fail();
    seen.add(condition.type);
    // Only known reason constants are safe; no free text, messages, logs,
    // annotations, or env values (even when they resemble enum identifiers).
    projectedConditions.push({ type: condition.type, status: condition.status,
      reason: allowedReasons.has(condition.reason) ? condition.reason : null,
      lastTransitionTime: timestamp(condition.lastTransitionTime) });
  }
  const taskCount = count(spec.taskCount);
  if (taskCount === 0) fail();
  return {
    name: metadata.name,
    createdAt: timestamp(metadata.creationTimestamp, true),
    startedAt: timestamp(status.startTime),
    completedAt: timestamp(status.completionTime),
    conditions: projectedConditions,
    tasks: {
      configured: taskCount,
      running: count(status.runningCount, taskCount),
      succeeded: count(status.succeededCount, taskCount),
      failed: count(status.failedCount, taskCount),
      cancelled: count(status.cancelledCount, taskCount),
      // retriedCount counts tasks retried at least once, not total attempts.
      retried: count(status.retriedCount, taskCount),
    },
    maxRetriesPerTask: task.maxRetries === undefined ? null : count(task.maxRetries, 10),
    imageDigest,
    // The execution snapshot contains effective args, including run overrides.
    effectiveArgs: graphArgs(container.args),
  };
}

let failure = "invalid-resource";
try {
  const project = process.env.GCP_PROJECT_ID, region = process.env.GCP_REGION;
  if (process.argv.length !== 2 || typeof project !== "string" || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)
    || typeof region !== "string" || !/^[a-z]+(?:-[a-z]+)+[0-9]$/.test(region)) fail();
  // Only list existing executions using the workflow's existing identity. Keep
  // all child output private, including permission errors and malformed JSON.
  let raw;
  try {
    raw = execFileSync("gcloud", ["run", "jobs", "executions", "list", "--job", job,
      "--project", project, "--region", region, `--limit=${limit}`, "--sort-by=~metadata.creationTimestamp",
      "--format=json", "--verbosity=none", "--quiet"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1_048_576, timeout: 60_000,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.slice(0, 1_048_576) : "";
    failure = /PERMISSION_DENIED|permission(?:s)? denied|does not have permission|do not have permission/i.test(stderr)
      ? "permission-denied" : "command-failed";
    fail();
  }
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > limit) fail();
  const executions = values.map(value => projectExecution(value, project, region));
  if (new Set(executions.map(value => value.name)).size !== executions.length) fail();
  executions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  // Build everything before printing: an invalid record never leaks a partial
  // result or the original resource. The projection has no free-text fields.
  console.log(JSON.stringify({ job, project, region, executions }, null, 2));
} catch {
  console.error(`Could not inspect graph executions (${failure}); resource details and command errors were withheld.`);
  process.exitCode = 1;
}
