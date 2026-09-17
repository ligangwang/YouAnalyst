import { createHash } from "node:crypto";
import { predictionInstrument } from "../predictions/instrument";
import { isPredictionDirection, type PredictionDirection, type PredictionVisibility } from "../predictions/types";

export type PostInput = { ticker: string; title: string; body: string; direction: PredictionDirection | null; visibility: PredictionVisibility; requestId: string };
export type Post = PostInput & { userId: string; companyId: string; predictionId: string | null; createdAt: string; initial: boolean };

export function validatePost(raw: unknown): PostInput {
  if (!raw || typeof raw !== "object") throw new Error("Invalid post");
  const value = raw as Record<string, unknown>;
  const instrument = typeof value.ticker === "string" ? predictionInstrument(value.ticker) : null;
  if (!instrument) throw new Error("Select a company");
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!title || title.length > 120 || !body || body.length > 10000) throw new Error("A title (up to 120 characters) and article (up to 10000 characters) are required");
  if (value.direction != null && !isPredictionDirection(value.direction)) throw new Error("Invalid direction");
  if (value.visibility !== "PUBLIC" && value.visibility !== "PRIVATE") throw new Error("Invalid visibility");
  if (typeof value.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)) throw new Error("Invalid request ID");
  return { ticker: instrument.ticker, title, body, direction: value.direction as PredictionDirection | null ?? null, visibility: value.visibility, requestId: value.requestId };
}

export function postId(userId: string, requestId: string) {
  return createHash("sha256").update(JSON.stringify([userId, requestId])).digest("hex");
}

export function assertSamePost(previous: Post, input: PostInput) {
  if (previous.ticker !== input.ticker || previous.title !== input.title || previous.body !== input.body || previous.direction !== input.direction || previous.visibility !== input.visibility) {
    throw new Error("This request ID was already used for a different post");
  }
}
