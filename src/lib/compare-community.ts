import { comparePath, compareSymbol, type CompareConfig } from "./compare";
import { parseCompanyColors } from "./compare-appearance";
import { validatePlaybackConfig } from "./ui/compare-range";

export type SharedComparison = { config: CompareConfig; theme: "dark" | "light" };
export type ComparisonSubmission = { title: string; body: string; requestId: string; comparison: SharedComparison };
export type CommunityComparison = ComparisonSubmission & {
  id: string; userId: string; authorName: string; createdAt: string;
  likes: number; dislikes: number; netLikes: number; commentCount: number; viewerVote: -1 | 0 | 1;
};
export type ComparisonComment = { id: string; userId: string; authorName: string; content: string; createdAt: string };

/** Only expose known validation messages; infrastructure errors can contain project details. */
export function comparisonActionFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "Comparison not found") return { error: message, status: 404 };
  if (/^(Invalid request ID|This request ID was already used for a different (post|comment)|A public profile is required|User profile required|Choose like, dislike, or remove vote|Write a comment between)/.test(message)) return { error: message, status: 400 };
  return { error: "The comparison could not be updated. Please retry.", status: 503 };
}

export function validCommunityId(id: string) { return /^[a-f0-9]{64}$/.test(id); }
export function validateRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) throw new Error("Invalid request ID");
  return value;
}
export function validateSharedComparison(raw: unknown): SharedComparison {
  if (!raw || typeof raw !== "object") throw new Error("Invalid comparison");
  const { config: input, theme } = raw as SharedComparison;
  if (!input || !Array.isArray(input.symbols) || input.symbols.length < 1 || input.symbols.length > 10 || input.symbols.some(symbol => typeof symbol !== "string" || !compareSymbol(symbol)) || new Set(input.symbols).size !== input.symbols.length || !["line", "bar"].includes(input.style)) throw new Error("Invalid stocks or chart style");
  const colors = parseCompanyColors(input.colors, 10);
  if (!colors || input.symbols.some(symbol => !colors[symbol]) || Object.keys(colors).length !== input.symbols.length) throw new Error("Choose a color for each stock");
  if (typeof input.start !== "string" || typeof input.end !== "string") throw new Error("Choose valid dates");
  const config: CompareConfig = { symbols: [...input.symbols], start: input.start, end: input.end, style: input.style, colors };
  const error = validatePlaybackConfig(config);
  if (error) throw new Error(error);
  if (theme !== "dark" && theme !== "light") throw new Error("Invalid chart theme");
  return { config, theme };
}
export function validateComparisonSubmission(raw: unknown): ComparisonSubmission {
  if (!raw || typeof raw !== "object") throw new Error("Invalid post");
  const value = raw as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!title || title.length > 120 || body.length > 2000) throw new Error("Add a title up to 120 characters and a message up to 2000 characters");
  return { title, body, requestId: validateRequestId(value.requestId), comparison: validateSharedComparison(value.comparison) };
}
export function sameComparisonSubmission(a: ComparisonSubmission, b: ComparisonSubmission) {
  return a.title === b.title && a.body === b.body && a.comparison.theme === b.comparison.theme && comparePath(a.comparison.config) === comparePath(b.comparison.config);
}
export function validateComparisonVote(value: unknown): -1 | 0 | 1 {
  if (value !== -1 && value !== 0 && value !== 1) throw new Error("Choose like, dislike, or remove vote");
  return value;
}
export function comparisonVoteTotals(likes: number, dislikes: number, previous: -1 | 0 | 1, next: -1 | 0 | 1) {
  const nextLikes = likes - Number(previous === 1) + Number(next === 1);
  const nextDislikes = dislikes - Number(previous === -1) + Number(next === -1);
  return { likes: nextLikes, dislikes: nextDislikes, netLikes: nextLikes - nextDislikes };
}
export function validateComparisonComment(raw: unknown) {
  const value = raw as Record<string, unknown> | null;
  const content = typeof value?.content === "string" ? value.content.trim() : "";
  if (!content || content.length > 2000) throw new Error("Write a comment between 1 and 2000 characters");
  return { content, requestId: validateRequestId(value?.requestId) };
}
