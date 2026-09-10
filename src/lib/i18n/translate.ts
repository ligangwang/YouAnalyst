import chinese from "./zh-CN.json";
import templates from "./templates-zh-CN.json";
import type { Locale } from "../locale";

function decode(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", mdash: "—", middot: "·" };
  return value.replace(/&(amp|lt|gt|quot|apos|nbsp|mdash|middot);/g, (_, key: string) => entities[key]);
}
const messages: Record<string, string> = Object.fromEntries(Object.entries(chinese).map(([key, value]) => [decode(key).trim(), value]));
const patterns = Object.entries(templates).map(([key, translation]) => {
  const slots: string[] = [];
  const escaped = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(part); return "(.*?)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { pattern: new RegExp(`^${escaped}$`), slots, translation };
});
export function translateUi(value: string, locale: Locale): string {
  value = decode(value);
  if (locale === "en") return value;
  const key = value.replace(/\s+/g, " ").trim();
  let translation = messages[key];
  if (translation === undefined) {
    for (const entry of patterns) {
      const match = entry.pattern.exec(key);
      if (!match) continue;
      translation = entry.translation.replace(/\{\d+\}/g, slot => {
        const captured = match[entry.slots.indexOf(slot) + 1] ?? "";
        return messages[captured] ?? captured;
      });
      break;
    }
  }
  if (translation === undefined) return value;
  return `${/^\s/.test(value) ? " " : ""}${translation}${/\s$/.test(value) ? " " : ""}`;
}
